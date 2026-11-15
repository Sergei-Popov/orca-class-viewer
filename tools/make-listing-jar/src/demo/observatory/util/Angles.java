package demo.observatory.util;

/** Angle arithmetic for pointing, in degrees and hours. */
public final class Angles {
    private Angles() {}

    public static double normalize(double degrees) {
        double d = degrees % 360;
        return d < 0 ? d + 360 : d;
    }

    /** The shorter way round between two directions. */
    public static double distance(double fromDeg, double toDeg) {
        double d = Math.abs(normalize(toDeg) - normalize(fromDeg));
        return d > 180 ? 360 - d : d;
    }

    public static double hourAngle(double siderealHours, double rightAscensionHours) {
        double h = (siderealHours - rightAscensionHours) % 24;
        return h < -12 ? h + 24 : h > 12 ? h - 24 : h;
    }

    public static double altitude(double declinationDeg, double latitudeDeg, double hourAngleHours) {
        double dec = Math.toRadians(declinationDeg);
        double lat = Math.toRadians(latitudeDeg);
        double ha = Math.toRadians(hourAngleHours * 15);
        return Math.toDegrees(Math.asin(Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha)));
    }

    public static double azimuth(double declinationDeg, double latitudeDeg, double hourAngleHours) {
        double dec = Math.toRadians(declinationDeg);
        double lat = Math.toRadians(latitudeDeg);
        double ha = Math.toRadians(hourAngleHours * 15);
        double y = -Math.sin(ha);
        double x = Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha);
        return normalize(Math.toDegrees(Math.atan2(y, x)));
    }
}
