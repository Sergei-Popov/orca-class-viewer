package demo.observatory.cli;

import demo.observatory.Observatory;
import demo.observatory.catalog.Star;
import demo.observatory.telescope.Slew;
import demo.observatory.util.Units;
import java.util.Optional;

/** observe STAR: point the telescope at a star of the catalog. */
public record ObserveCommand(String target, double exposureSeconds) implements Command {
    @Override
    public String name() {
        return "observe";
    }

    @Override
    public ExitCode run(Observatory observatory, Console console) {
        Optional<Star> star = observatory.stars().find(target);
        if (star.isEmpty()) {
            console.error("no star named " + target + " in the catalog");
            return ExitCode.DATA;
        }
        Slew slew = observatory.telescope().point(star.get().position());
        if (!slew.accepted()) {
            console.error(target + ": " + slew.reason());
            return ExitCode.UNAVAILABLE;
        }
        console.println(String.format("%s (%s): slewing %.1f s, then %.0f s exposures",
                target, Units.formatDistance(star.get().distanceLy()), slew.seconds(), exposureSeconds));
        observatory.telescope().observe(star.get()).ifPresent(o -> console.println(o.note()));
        return ExitCode.OK;
    }
}
