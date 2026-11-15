package demo.observatory.net;

import java.net.URI;

/** Where a service lives. */
public record Endpoint(String scheme, String host, int port, String path) {
    public static Endpoint parse(String uri) {
        URI u = URI.create(uri);
        int port = u.getPort() != -1 ? u.getPort() : "https".equals(u.getScheme()) ? 443 : 80;
        return new Endpoint(u.getScheme(), u.getHost(), port, u.getPath());
    }

    public Endpoint resolve(String name) {
        return new Endpoint(scheme, host, port, path + "/" + name);
    }

    public URI uri() {
        return URI.create(scheme + "://" + host + ":" + port + path);
    }
}
