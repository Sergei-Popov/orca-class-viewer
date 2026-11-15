package demo.observatory.telescope;

import demo.observatory.catalog.Coordinates;
import demo.observatory.util.Angles;

/** A German equatorial mount: one axis follows the sky. */
public final class EquatorialMount implements Mount {
    private static final double RATE_DEG_PER_S = 3.0;

    private final double latitudeDeg;
    private double siderealHours;
    private double hourAngle;
    private double polarErrorArcmin;

    public EquatorialMount(double latitudeDeg) {
        this.latitudeDeg = latitudeDeg;
    }

    public void setSiderealTime(double hours) {
        this.siderealHours = hours;
    }

    public void alignPolar(double errorArcmin) {
        this.polarErrorArcmin = Math.abs(errorArcmin);
    }

    public boolean aligned() {
        return polarErrorArcmin < 5;
    }

    @Override
    public double latitudeDeg() {
        return latitudeDeg;
    }

    @Override
    public double altitudeOf(Coordinates target) {
        double ha = Angles.hourAngle(siderealHours, target.rightAscensionHours());
        return Angles.altitude(target.declinationDeg(), latitudeDeg, ha);
    }

    @Override
    public Slew slewTo(Coordinates target) {
        double next = Angles.hourAngle(siderealHours, target.rightAscensionHours());
        double seconds = Math.abs(next - hourAngle) * 15 / RATE_DEG_PER_S;
        hourAngle = next;
        return Slew.to(target, seconds);
    }
}
