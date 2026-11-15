package demo.observatory.net;

import java.util.Map;

public record Request(String method, Endpoint endpoint, Map<String, String> headers, byte[] body) {
    public static final String USER_AGENT = "observatory/2.0";

    public static Request get(Endpoint endpoint) {
        return new Request("GET", endpoint, Map.of("User-Agent", USER_AGENT), new byte[0]);
    }

    public static Request put(Endpoint endpoint, String contentType, byte[] body) {
        return new Request("PUT", endpoint, Map.of("User-Agent", USER_AGENT, "Content-Type", contentType), body);
    }
}
