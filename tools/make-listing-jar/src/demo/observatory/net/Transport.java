package demo.observatory.net;

import java.io.IOException;

/** Sends one request; tests and offline nights bring their own. */
@FunctionalInterface
public interface Transport {
    Response send(Request request) throws IOException;
}
