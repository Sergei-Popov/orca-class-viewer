package demo.observatory.cli;

import demo.observatory.Observatory;
import demo.observatory.catalog.Star;
import demo.observatory.schedule.Ephemeris;
import demo.observatory.schedule.Plan;
import demo.observatory.schedule.Priority;
import demo.observatory.schedule.Target;
import demo.observatory.schedule.Twilight;
import demo.observatory.schedule.Window;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** plan DATE: the catalog's stars that fit into that night. */
public record PlanCommand(LocalDate night, int maxTargets) implements Command {
    @Override
    public String name() {
        return "plan";
    }

    @Override
    public ExitCode run(Observatory observatory, Console console) {
        Ephemeris ephemeris = new Ephemeris(Observatory.DEFAULT_LATITUDE_DEG, -105.0);
        Plan plan = new Plan("night of " + night, ephemeris.darkness(night, Twilight.ASTRONOMICAL));
        for (Star star : observatory.stars()) {
            if (plan.targets().size() == maxTargets) {
                break;
            }
            plan.add(new Target(star, star.nakedEye() ? Priority.NORMAL : Priority.HIGH, Duration.ofMinutes(10)));
        }
        List<Window> slots = observatory.scheduler().schedule(plan);
        List<String[]> rows = new ArrayList<>();
        rows.add(new String[] {"#", "start", "minutes"});
        for (int i = 0; i < slots.size(); i++) {
            Window slot = slots.get(i);
            rows.add(new String[] {String.valueOf(i + 1), slot.start().toString(), String.valueOf(slot.duration().toMinutes())});
        }
        console.table(rows);
        return slots.isEmpty() ? ExitCode.UNAVAILABLE : ExitCode.OK;
    }
}
