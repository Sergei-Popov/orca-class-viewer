package demo.observatory.schedule;

import java.time.Duration;
import java.time.Instant;

/** A span of the night, from start inclusive to end exclusive. */
public record Window(Instant start, Instant end) {
    public Window {
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("window ends before it starts");
        }
    }

    public Duration duration() {
        return Duration.between(start, end);
    }

    public boolean contains(Instant at) {
        return !at.isBefore(start) && at.isBefore(end);
    }

    public boolean overlaps(Window other) {
        return start.isBefore(other.end) && other.start.isBefore(end);
    }
}
