// MEO website server
// -----------------
// A small, dependency-free (header-only) C++17 web server for the
// Maritime Empowerment Organization site. It:
//   * serves the website in ./public
//   * serves editable site content from ./data/content.json   (GET /api/content)
//   * saves newsletter sign-ups, contact messages and donation pledges
//     to JSON-lines files in ./data/submissions                (POST /api/...)
//   * gives staff a token-protected admin API + CSV export      (/api/admin/...)
//
// Build:  cmake -B build && cmake --build build -j
// Run:    MEO_ADMIN_TOKEN=change-me ./build/meo_server --port 8080
//
// Libraries (bundled in third_party/): cpp-httplib (MIT), nlohmann/json (MIT).

#include "httplib.h"
#include "json.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <ctime>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <random>
#include <regex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using json = nlohmann::json;
namespace fs = std::filesystem;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
struct Config {
    std::string host = "0.0.0.0";
    int port = 8080;
    fs::path publicDir = "public";
    fs::path dataDir = "data";
    std::string adminToken;          // empty = admin API disabled
    int postsPerMinute = 10;         // per client IP, for form endpoints
};

static std::string envOr(const char* key, const std::string& fallback) {
    const char* v = std::getenv(key);
    return (v && *v) ? std::string(v) : fallback;
}

static Config loadConfig(int argc, char** argv) {
    Config c;
    c.host = envOr("MEO_HOST", c.host);
    c.port = std::stoi(envOr("MEO_PORT", std::to_string(c.port)));
    c.publicDir = envOr("MEO_PUBLIC_DIR", c.publicDir.string());
    c.dataDir = envOr("MEO_DATA_DIR", c.dataDir.string());
    c.adminToken = envOr("MEO_ADMIN_TOKEN", "");
    for (int i = 1; i + 1 < argc; i += 2) {
        std::string k = argv[i], v = argv[i + 1];
        if (k == "--port") c.port = std::stoi(v);
        else if (k == "--host") c.host = v;
        else if (k == "--public") c.publicDir = v;
        else if (k == "--data") c.dataDir = v;
    }
    return c;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
static std::string nowIso() {
    auto t = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    std::ostringstream os;
    os << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
    return os.str();
}

static std::string newId() {
    static std::mt19937_64 rng{std::random_device{}()};
    static std::mutex m;
    std::lock_guard<std::mutex> lock(m);
    std::ostringstream os;
    os << std::hex << std::setw(16) << std::setfill('0') << rng();
    return os.str().substr(0, 12);
}

static std::string trim(const std::string& s) {
    auto b = s.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return "";
    auto e = s.find_last_not_of(" \t\r\n");
    return s.substr(b, e - b + 1);
}

static std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char ch) { return std::tolower(ch); });
    return s;
}

static bool validEmail(const std::string& e) {
    static const std::regex re(R"(^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$)");
    return e.size() <= 254 && std::regex_match(e, re);
}

static bool validPhone(const std::string& p) {
    static const std::regex re(R"(^\+?[0-9 ()\-]{7,20}$)");
    return std::regex_match(p, re);
}

// Read a string field from a JSON body, trimmed and length-limited.
static std::string field(const json& body, const char* key, size_t maxLen) {
    if (!body.contains(key) || !body[key].is_string()) return "";
    std::string v = trim(body[key].get<std::string>());
    if (v.size() > maxLen) v.resize(maxLen);
    return v;
}

// Constant-time comparison so the admin token can't be guessed by timing.
static bool safeEquals(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (size_t i = 0; i < a.size(); ++i) diff |= static_cast<unsigned char>(a[i] ^ b[i]);
    return diff == 0;
}

static std::string csvCell(const std::string& v) {
    std::string out = "\"";
    for (char ch : v) { if (ch == '"') out += "\"\""; else out += ch; }
    out += "\"";
    // Neutralise spreadsheet formula injection.
    if (!v.empty() && (v[0] == '=' || v[0] == '+' || v[0] == '-' || v[0] == '@')) out.insert(1, "'");
    return out;
}

static void sendJson(httplib::Response& res, int status, const json& body) {
    res.status = status;
    res.set_header("Cache-Control", "no-store");
    res.set_content(body.dump(), "application/json; charset=utf-8");
}

static void sendError(httplib::Response& res, int status, const std::string& msg,
                      const json& fields = json::object()) {
    json b = {{"ok", false}, {"error", msg}};
    if (!fields.empty()) b["fields"] = fields;
    sendJson(res, status, b);
}

// ---------------------------------------------------------------------------
// Storage: one JSON object per line, append-only, thread-safe.
// ---------------------------------------------------------------------------
class Store {
public:
    explicit Store(fs::path dir) : dir_(std::move(dir)) {
        fs::create_directories(dir_);
        for (const auto& row : readAll("subscribers"))
            if (row.contains("email")) subscriberEmails_.insert(lower(row["email"].get<std::string>()));
    }

    void append(const std::string& kind, const json& row) {
        std::lock_guard<std::mutex> lock(m_);
        std::ofstream f(path(kind), std::ios::app);
        f << row.dump() << "\n";
    }

    std::vector<json> readAll(const std::string& kind) const {
        std::lock_guard<std::mutex> lock(m_);
        std::vector<json> rows;
        std::ifstream f(path(kind));
        std::string line;
        while (std::getline(f, line)) {
            if (line.empty()) continue;
            try { rows.push_back(json::parse(line)); } catch (...) { /* skip a damaged line */ }
        }
        return rows;
    }

    // Returns false if the email was already subscribed.
    bool addSubscriber(const json& row) {
        std::string key = lower(row["email"].get<std::string>());
        {
            std::lock_guard<std::mutex> lock(m_);
            if (subscriberEmails_.count(key)) return false;
            subscriberEmails_.insert(key);
        }
        append("subscribers", row);
        return true;
    }

private:
    fs::path path(const std::string& kind) const { return dir_ / (kind + ".jsonl"); }
    fs::path dir_;
    mutable std::mutex m_;
    std::unordered_set<std::string> subscriberEmails_;
};

// ---------------------------------------------------------------------------
// Site content: data/content.json, reloaded automatically when edited.
// ---------------------------------------------------------------------------
class Content {
public:
    explicit Content(fs::path file) : file_(std::move(file)) { reloadIfChanged(); }

    json get() {
        reloadIfChanged();
        std::lock_guard<std::mutex> lock(m_);
        return data_;
    }

private:
    void reloadIfChanged() {
        std::error_code ec;
        auto mt = fs::last_write_time(file_, ec);
        if (ec) return;
        std::lock_guard<std::mutex> lock(m_);
        if (loaded_ && mt == mtime_) return;
        try {
            std::ifstream f(file_);
            json next = json::parse(f);
            data_ = std::move(next);
            mtime_ = mt;
            loaded_ = true;
            std::cout << "[content] loaded " << file_ << "\n";
        } catch (const std::exception& e) {
            // Keep serving the last good version if an edit has a typo.
            std::cerr << "[content] could not parse " << file_ << ": " << e.what() << "\n";
            mtime_ = mt;
        }
    }

    fs::path file_;
    std::mutex m_;
    json data_ = json::object();
    fs::file_time_type mtime_{};
    bool loaded_ = false;
};

// ---------------------------------------------------------------------------
// Rate limiting for form posts (per IP, sliding one-minute window).
// ---------------------------------------------------------------------------
class RateLimiter {
public:
    explicit RateLimiter(int perMinute) : limit_(perMinute) {}
    bool allow(const std::string& ip) {
        using clock = std::chrono::steady_clock;
        auto now = clock::now();
        std::lock_guard<std::mutex> lock(m_);
        auto& q = hits_[ip];
        while (!q.empty() && now - q.front() > std::chrono::minutes(1)) q.pop_front();
        if (static_cast<int>(q.size()) >= limit_) return false;
        q.push_back(now);
        return true;
    }
private:
    int limit_;
    std::mutex m_;
    std::unordered_map<std::string, std::deque<std::chrono::steady_clock::time_point>> hits_;
};

// Parse a JSON request body; on failure write the error response and return false.
static bool parseBody(const httplib::Request& req, httplib::Response& res, json& out) {
    if (req.body.size() > 16 * 1024) { sendError(res, 413, "Request is too large."); return false; }
    try { out = json::parse(req.body); }
    catch (...) { sendError(res, 400, "Please send valid JSON."); return false; }
    if (!out.is_object()) { sendError(res, 400, "Please send a JSON object."); return false; }
    return true;
}

// Bots fill hidden fields; real visitors never see the "website" field.
static bool isBot(const json& body) {
    return body.contains("website") && body["website"].is_string() && !body["website"].get<std::string>().empty();
}

// ---------------------------------------------------------------------------
int main(int argc, char** argv) {
    Config cfg = loadConfig(argc, argv);
    Store store(cfg.dataDir / "submissions");
    Content content(cfg.dataDir / "content.json");
    RateLimiter limiter(cfg.postsPerMinute);
    std::atomic<long> requests{0};

    httplib::Server app;
    app.set_payload_max_length(64 * 1024);

    // Security headers on every response.
    app.set_post_routing_handler([&](const httplib::Request& req, httplib::Response& res) {
        requests++;
        res.set_header("X-Content-Type-Options", "nosniff");
        res.set_header("X-Frame-Options", "DENY");
        res.set_header("Referrer-Policy", "strict-origin-when-cross-origin");
        res.set_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        res.set_header("Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
        if (req.path.rfind("/assets/", 0) == 0) res.set_header("Cache-Control", "public, max-age=604800");
    });

    app.set_logger([](const httplib::Request& req, const httplib::Response& res) {
        std::cout << nowIso() << " " << req.method << " " << req.path << " " << res.status << "\n";
    });

    // ---- public API -------------------------------------------------------
    app.Get("/api/health", [&](const httplib::Request&, httplib::Response& res) {
        sendJson(res, 200, {{"ok", true}, {"time", nowIso()}, {"requests", requests.load()}});
    });

    app.Get("/api/content", [&](const httplib::Request&, httplib::Response& res) {
        res.set_header("Cache-Control", "no-cache");
        res.set_content(content.get().dump(), "application/json; charset=utf-8");
    });

    app.Post("/api/subscribe", [&](const httplib::Request& req, httplib::Response& res) {
        if (!limiter.allow(req.remote_addr)) return sendError(res, 429, "Too many requests. Please try again in a minute.");
        json body;
        if (!parseBody(req, res, body)) return;
        if (isBot(body)) return sendJson(res, 200, {{"ok", true}});
        std::string email = lower(field(body, "email", 254));
        std::string name = field(body, "name", 120);
        if (!validEmail(email)) return sendError(res, 422, "Please enter a valid email address.", {{"email", "invalid"}});
        json row = {{"id", newId()}, {"created_at", nowIso()}, {"email", email}, {"name", name}};
        bool added = store.addSubscriber(row);
        sendJson(res, added ? 201 : 200, {{"ok", true}, {"message", added ? "Thank you for subscribing!" : "You're already subscribed."}});
    });

    app.Post("/api/contact", [&](const httplib::Request& req, httplib::Response& res) {
        if (!limiter.allow(req.remote_addr)) return sendError(res, 429, "Too many requests. Please try again in a minute.");
        json body;
        if (!parseBody(req, res, body)) return;
        if (isBot(body)) return sendJson(res, 200, {{"ok", true}});
        json row = {{"id", newId()}, {"created_at", nowIso()},
                    {"name", field(body, "name", 120)}, {"email", lower(field(body, "email", 254))},
                    {"phone", field(body, "phone", 30)}, {"subject", field(body, "subject", 160)},
                    {"message", field(body, "message", 4000)}, {"status", "new"}};
        json errs = json::object();
        if (row["name"].get<std::string>().size() < 2) errs["name"] = "required";
        if (!validEmail(row["email"])) errs["email"] = "invalid";
        if (!row["phone"].get<std::string>().empty() && !validPhone(row["phone"])) errs["phone"] = "invalid";
        if (row["message"].get<std::string>().size() < 10) errs["message"] = "too short";
        if (!errs.empty()) return sendError(res, 422, "Please check the highlighted fields.", errs);
        store.append("messages", row);
        sendJson(res, 201, {{"ok", true}, {"message", "Thank you. Our team will reply within 2 working days."}});
    });

    app.Post("/api/pledge", [&](const httplib::Request& req, httplib::Response& res) {
        if (!limiter.allow(req.remote_addr)) return sendError(res, 429, "Too many requests. Please try again in a minute.");
        json body;
        if (!parseBody(req, res, body)) return;
        if (isBot(body)) return sendJson(res, 200, {{"ok", true}});
        long long amount = 0;
        if (body.contains("amount") && body["amount"].is_number()) amount = body["amount"].get<long long>();
        else if (body.contains("amount") && body["amount"].is_string()) {
            try { amount = std::stoll(body["amount"].get<std::string>()); } catch (...) { amount = 0; }
        }
        json row = {{"id", newId()}, {"created_at", nowIso()},
                    {"name", field(body, "name", 120)}, {"email", lower(field(body, "email", 254))},
                    {"phone", field(body, "phone", 30)}, {"amount", amount},
                    {"currency", field(body, "currency", 3).empty() ? "TZS" : field(body, "currency", 3)},
                    {"programme", field(body, "programme", 80)}, {"note", field(body, "note", 1000)},
                    {"status", "pledged"}};
        json errs = json::object();
        if (row["name"].get<std::string>().size() < 2) errs["name"] = "required";
        bool hasEmail = !row["email"].get<std::string>().empty(), hasPhone = !row["phone"].get<std::string>().empty();
        if (!hasEmail && !hasPhone) errs["email"] = "email or phone required";
        if (hasEmail && !validEmail(row["email"])) errs["email"] = "invalid";
        if (hasPhone && !validPhone(row["phone"])) errs["phone"] = "invalid";
        if (amount < 1000 || amount > 1000000000LL) errs["amount"] = "invalid";
        if (!errs.empty()) return sendError(res, 422, "Please check the highlighted fields.", errs);
        store.append("pledges", row);
        sendJson(res, 201, {{"ok", true}, {"reference", "MEO-" + row["id"].get<std::string>()},
                            {"message", "Thank you! Please use your reference when you make the bank transfer."}});
    });

    // ---- admin API (Authorization: Bearer <MEO_ADMIN_TOKEN>) --------------
    auto authorised = [&](const httplib::Request& req, httplib::Response& res) {
        if (cfg.adminToken.empty()) { sendError(res, 503, "Admin is disabled. Set MEO_ADMIN_TOKEN to enable it."); return false; }
        std::string h = req.get_header_value("Authorization");
        const std::string prefix = "Bearer ";
        if (h.rfind(prefix, 0) != 0 || !safeEquals(h.substr(prefix.size()), cfg.adminToken)) {
            sendError(res, 401, "Not authorised.");
            return false;
        }
        return true;
    };
    const std::vector<std::string> kinds = {"subscribers", "messages", "pledges"};

    app.Get("/api/admin/summary", [&](const httplib::Request& req, httplib::Response& res) {
        if (!authorised(req, res)) return;
        json out = {{"ok", true}};
        long long pledged = 0;
        for (const auto& k : kinds) out[k] = store.readAll(k).size();
        for (const auto& p : store.readAll("pledges")) pledged += p.value("amount", 0LL);
        out["pledged_total_tzs"] = pledged;
        sendJson(res, 200, out);
    });

    app.Get(R"(/api/admin/(subscribers|messages|pledges))", [&](const httplib::Request& req, httplib::Response& res) {
        if (!authorised(req, res)) return;
        auto rows = store.readAll(req.matches[1]);
        std::reverse(rows.begin(), rows.end());  // newest first
        sendJson(res, 200, {{"ok", true}, {"rows", rows}});
    });

    app.Get(R"(/api/admin/(subscribers|messages|pledges)\.csv)", [&](const httplib::Request& req, httplib::Response& res) {
        if (!authorised(req, res)) return;
        std::string kind = req.matches[1];
        auto rows = store.readAll(kind);
        std::vector<std::string> cols;
        for (const auto& r : rows) for (auto it = r.begin(); it != r.end(); ++it)
            if (std::find(cols.begin(), cols.end(), it.key()) == cols.end()) cols.push_back(it.key());
        std::ostringstream os;
        for (size_t i = 0; i < cols.size(); ++i) os << (i ? "," : "") << csvCell(cols[i]);
        os << "\r\n";
        for (const auto& r : rows) {
            for (size_t i = 0; i < cols.size(); ++i) {
                std::string v;
                if (r.contains(cols[i])) v = r[cols[i]].is_string() ? r[cols[i]].get<std::string>() : r[cols[i]].dump();
                os << (i ? "," : "") << csvCell(v);
            }
            os << "\r\n";
        }
        res.set_header("Content-Disposition", "attachment; filename=\"meo-" + kind + ".csv\"");
        res.set_header("Cache-Control", "no-store");
        res.set_content(os.str(), "text/csv; charset=utf-8");
    });

    // Unknown API routes -> JSON 404 (static files are handled below).
    app.set_error_handler([](const httplib::Request& req, httplib::Response& res) {
        if (req.path.rfind("/api/", 0) == 0 && res.body.empty())
            sendError(res, res.status, res.status == 404 ? "Not found." : "Request failed.");
    });

    // ---- website -----------------------------------------------------------
    if (!app.set_mount_point("/", cfg.publicDir.string())) {
        std::cerr << "Public folder not found: " << cfg.publicDir << "\n";
        return 1;
    }

    std::cout << "MEO server on http://" << (cfg.host == "0.0.0.0" ? "localhost" : cfg.host) << ":" << cfg.port << "\n"
              << "  public: " << fs::absolute(cfg.publicDir) << "\n"
              << "  data:   " << fs::absolute(cfg.dataDir) << "\n"
              << "  admin:  " << (cfg.adminToken.empty() ? "disabled (set MEO_ADMIN_TOKEN)" : "enabled at /admin.html") << "\n";
    if (!app.listen(cfg.host, cfg.port)) {
        std::cerr << "Could not listen on port " << cfg.port << "\n";
        return 1;
    }
    return 0;
}
