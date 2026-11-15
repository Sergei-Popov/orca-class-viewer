package demo.observatory.util;

import java.time.Instant;

/** The time, replaceable in tests. */
@FunctionalInterface
public interface Clock {
    Instant now();

    static Clock system() {
        return Instant::now;
    }

    static Clock fixed(Instant at) {
        return () -> at;
    }
}
