package demo.observatory.schedule;

import demo.observatory.weather.Conditions;
import demo.observatory.weather.Seeing;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.PriorityQueue;

/** Orders a plan's targets by priority and fits them into the night. */
public class Scheduler {
    private final Conditions sky;

    public Scheduler(Conditions sky) {
        this.sky = sky;
    }

    public List<Window> schedule(Plan plan) {
        List<Window> slots = new ArrayList<>();
        if (!sky.observable()) {
            return slots;
        }
        PriorityQueue<Target> queue = new PriorityQueue<>(plan.targets());
        Instant at = plan.window().start();
        while (!queue.isEmpty()) {
            Target target = queue.poll();
            Duration exposure = sky.seeing() == Seeing.POOR ? target.exposure().multipliedBy(2) : target.exposure();
            Window slot = new Window(at, at.plus(exposure));
            if (slot.end().isAfter(plan.window().end())) {
                break;
            }
            slots.add(slot);
            at = slot.end();
        }
        return slots;
    }
}
