# Build and run the MEO site in one small container.
FROM gcc:13 AS build
RUN apt-get update && apt-get install -y --no-install-recommends cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY server ./server
COPY third_party ./third_party
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /src/build/meo_server /app/meo_server
COPY public ./public
COPY data/content.json ./data/content.json
ENV MEO_PORT=8080
EXPOSE 8080
VOLUME ["/app/data/submissions"]
CMD ["/app/meo_server"]
