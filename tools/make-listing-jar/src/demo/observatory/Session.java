package demo.observatory;

import demo.observatory.schedule.Plan;
import demo.observatory.weather.Conditions;
import java.time.Instant;
import java.util.List;

/** One night at the telescope: the plan, the sky and what was seen. */
public record Session(String site, Instant start, Plan plan, Conditions sky, List<Telescope.Observation> log) {
    public Session {
        log = List.copyOf(log);
    }

    public boolean productive() {
        return log.size() * 2 >= plan.targets().size();
    }
}
