package demo.observatory.telescope;

import demo.observatory.catalog.Coordinates;

/** The result of pointing: how long the mount turns, or why it would not. */
public record Slew(Coordinates target, boolean accepted, double seconds, String reason) {
    public static Slew to(Coordinates target, double seconds) {
        return new Slew(target, true, seconds, "");
    }

    public static Slew refused(Coordinates target, String reason) {
        return new Slew(target, false, 0, reason);
    }
}
