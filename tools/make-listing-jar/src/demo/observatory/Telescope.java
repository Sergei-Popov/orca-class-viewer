package demo.observatory;

import demo.observatory.catalog.CelestialBody;
import demo.observatory.catalog.Coordinates;
import demo.observatory.catalog.Galaxy;
import demo.observatory.catalog.Planet;
import demo.observatory.catalog.Star;
import demo.observatory.telescope.FilterWheel;
import demo.observatory.telescope.Mount;
import demo.observatory.telescope.Optics;
import demo.observatory.telescope.Slew;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.function.Predicate;

/** Points at bodies of the catalog and keeps a log of what it saw. */
public final class Telescope implements AutoCloseable {
    public static final double MIN_ALTITUDE_DEG = 15.0;
    public static final int FILTER_SLOTS = 5;

    private final String name;
    private final Optics optics;
    private final Mount mount;
    private final FilterWheel filters = new FilterWheel(FILTER_SLOTS);
    private final List<Observation> log = new ArrayList<>();
    private boolean parked = true;

    /** One entry of the observing log. */
    public record Observation(CelestialBody target, double magnitude, String note) {
        public Observation {
            if (magnitude > 30) {
                throw new IllegalArgumentException("too faint: " + magnitude);
            }
        }
    }

    public Telescope(String name, Optics optics, Mount mount) {
        this.name = name;
        this.optics = optics;
        this.mount = mount;
    }

    /** Turns the mount to a target, unless it is too low over the horizon. */
    public Slew point(Coordinates target) {
        double altitude = mount.altitudeOf(target);
        if (altitude < MIN_ALTITUDE_DEG) {
            return Slew.refused(target, "below " + MIN_ALTITUDE_DEG + "°");
        }
        parked = false;
        return mount.slewTo(target);
    }

    public Optional<Observation> observe(CelestialBody body) {
        double magnitude = body.apparentMagnitude();
        if (magnitude > optics.limitingMagnitude()) {
            return Optional.empty();
        }
        String note = switch (body) {
            case Planet p when p.hasRings() -> "rings of " + p.name() + " visible";
            case Planet p -> p.moons() + " moons around " + p.name();
            case Star s -> "spectral class " + s.spectralClass();
            case Galaxy g -> g.morphology().name().toLowerCase() + " galaxy";
            default -> body.name() + " at magnitude " + magnitude;
        };
        Observation observation = new Observation(body, magnitude, note);
        log.add(observation);
        return Optional.of(observation);
    }

    public List<Observation> brightest(int limit, Predicate<? super Observation> filter) {
        return log.stream()
                .filter(filter)
                .sorted(Comparator.comparingDouble(Observation::magnitude))
                .limit(limit)
                .toList();
    }

    public FilterWheel filters() {
        return filters;
    }

    public Runnable tracker(final CelestialBody body) {
        return new Runnable() {
            private int steps;

            @Override
            public void run() {
                steps++;
                System.out.println(name + " tracks " + body.name() + " (" + steps + ")");
            }
        };
    }

    public void park() {
        parked = true;
    }

    public boolean parked() {
        return parked;
    }

    @Override
    public void close() {
        park();
        log.clear();
    }

    @Override
    public String toString() {
        return "Telescope[" + name + ", " + optics.apertureMm() + " mm]";
    }
}
