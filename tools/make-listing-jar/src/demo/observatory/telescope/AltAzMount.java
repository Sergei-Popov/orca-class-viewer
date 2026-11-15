package demo.observatory.telescope;

import demo.observatory.catalog.Coordinates;
import demo.observatory.util.Angles;

/** A fork mount that turns in altitude and azimuth. */
public final class AltAzMount implements Mount {
    private static final double RATE_DEG_PER_S = 4.0;

    private final double latitudeDeg;
    private double siderealHours;
    private double azimuthDeg;

    public AltAzMount(double latitudeDeg) {
        this.latitudeDeg = latitudeDeg;
    }

    public void setSiderealTime(double hours) {
        this.siderealHours = hours;
    }

    @Override
    public double latitudeDeg() {
        return latitudeDeg;
    }

    @Override
    public double altitudeOf(Coordinates target) {
        double hourAngle = Angles.hourAngle(siderealHours, target.rightAscensionHours());
        return Angles.altitude(target.declinationDeg(), latitudeDeg, hourAngle);
    }

    @Override
    public Slew slewTo(Coordinates target) {
        double hourAngle = Angles.hourAngle(siderealHours, target.rightAscensionHours());
        double azimuth = Angles.azimuth(target.declinationDeg(), latitudeDeg, hourAngle);
        double seconds = Angles.distance(azimuthDeg, azimuth) / RATE_DEG_PER_S;
        azimuthDeg = azimuth;
        return Slew.to(target, seconds);
    }
}
