package demo.observatory.imaging;

import java.time.Instant;

public record Exposure(double seconds, int gain, String filter, Instant start) {
    public static Exposure of(double seconds, String filter) {
        return new Exposure(seconds, 100, filter, Instant.EPOCH);
    }

    public Instant end() {
        return start.plusMillis(Math.round(seconds * 1000));
    }
}
