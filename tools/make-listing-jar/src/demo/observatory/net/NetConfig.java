package demo.observatory.net;

import java.util.Map;

/** The services the observatory talks to (documentation hosts and addresses only). */
public final class NetConfig {
    public static final String ARCHIVE_URL = "https://archive.example.com/v2/frames";
    public static final String WEATHER_URL = "https://weather.example.com/api/night";
    public static final String DOME_CONTROLLER = "192.0.2.17";
    public static final String MIRROR = "198.51.100.40";
    public static final int TIMEOUT_MS = 15_000;

    private final Endpoint archive;
    private final Endpoint weather;
    private final Transport transport;

    public NetConfig(Endpoint archive, Endpoint weather, Transport transport) {
        this.archive = archive;
        this.weather = weather;
        this.transport = transport;
    }

    public static NetConfig defaults() {
        return new NetConfig(Endpoint.parse(ARCHIVE_URL), Endpoint.parse(WEATHER_URL), offline());
    }

    /** A transport for nights without a network: every service is unavailable. */
    public static Transport offline() {
        return request -> new Response(503, Map.of("Retry-After", "600"), new byte[0]);
    }

    public Endpoint archive() {
        return archive;
    }

    public Endpoint weather() {
        return weather;
    }

    public Transport transport() {
        return transport;
    }
}
