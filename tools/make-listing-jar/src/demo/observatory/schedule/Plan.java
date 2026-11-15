package demo.observatory.schedule;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Targets for one night, inside its dark window. */
public class Plan {
    private final String name;
    private final Window window;
    private final List<Target> targets = new ArrayList<>();

    public Plan(String name, Window window) {
        this.name = name;
        this.window = window;
    }

    public Plan add(Target target) {
        targets.add(target);
        return this;
    }

    public List<Target> targets() {
        return Collections.unmodifiableList(targets);
    }

    public Duration totalExposure() {
        return targets.stream().map(Target::exposure).reduce(Duration.ZERO, Duration::plus);
    }

    public boolean fits() {
        return totalExposure().compareTo(window.duration()) <= 0;
    }

    public String name() {
        return name;
    }

    public Window window() {
        return window;
    }
}
