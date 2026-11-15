package demo.observatory.net;

import java.nio.charset.StandardCharsets;
import java.util.Map;

public record Response(int status, Map<String, String> headers, byte[] body) {
    public boolean ok() {
        return status >= 200 && status < 300;
    }

    public String text() {
        return new String(body, StandardCharsets.UTF_8);
    }
}
