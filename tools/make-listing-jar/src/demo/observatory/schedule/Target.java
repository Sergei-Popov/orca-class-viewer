package demo.observatory.schedule;

import demo.observatory.catalog.CelestialBody;
import java.time.Duration;
import java.util.Comparator;

/** A body to observe tonight, how urgently, and for how long. */
public record Target(CelestialBody body, Priority priority, Duration exposure) implements Comparable<Target> {
    private static final Comparator<Target> ORDER = Comparator
            .comparing(Target::priority, Comparator.reverseOrder())
            .thenComparingDouble(t -> t.body().apparentMagnitude());

    @Override
    public int compareTo(Target other) {
        return ORDER.compare(this, other);
    }
}
