package demo.observatory.schedule;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

/** Rough sun times for planning, good to a few minutes away from the poles. */
public final class Ephemeris {
    private final double latitudeDeg;
    private final double longitudeDeg;

    public Ephemeris(double latitudeDeg, double longitudeDeg) {
        this.latitudeDeg = latitudeDeg;
        this.longitudeDeg = longitudeDeg;
    }

    /** The sun's declination on a day of the year, in degrees. */
    public static double solarDeclination(int dayOfYear) {
        return -23.44 * Math.cos(Math.toRadians(360.0 / 365 * (dayOfYear + 10)));
    }

    /** Hours from local noon until the sun reaches the twilight's altitude, or NaN if it never does. */
    public double hoursFromNoon(LocalDate date, Twilight twilight) {
        double dec = Math.toRadians(solarDeclination(date.getDayOfYear()));
        double lat = Math.toRadians(latitudeDeg);
        double h = Math.toRadians(twilight.sunAltitudeDeg());
        double cos = (Math.sin(h) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
        return Math.abs(cos) > 1 ? Double.NaN : Math.toDegrees(Math.acos(cos)) / 15;
    }

    /** The dark part of the night that starts on this date. */
    public Window darkness(LocalDate date, Twilight twilight) {
        double hours = hoursFromNoon(date, twilight);
        if (Double.isNaN(hours)) {
            throw new IllegalArgumentException("no " + twilight.name().toLowerCase() + " darkness on " + date);
        }
        Instant noon = date.atTime(12, 0).toInstant(ZoneOffset.UTC).minusSeconds(Math.round(longitudeDeg / 15 * 3600));
        Duration half = Duration.ofMinutes(Math.round(hours * 60));
        return new Window(noon.plus(half), noon.plus(Duration.ofHours(24)).minus(half));
    }

    public double latitudeDeg() {
        return latitudeDeg;
    }
}
