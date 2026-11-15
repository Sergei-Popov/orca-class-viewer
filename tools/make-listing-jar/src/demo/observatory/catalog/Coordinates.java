package demo.observatory.catalog;

/** Equatorial coordinates, J2000. */
public record Coordinates(double rightAscensionHours, double declinationDeg) {
    public Coordinates {
        if (rightAscensionHours < 0 || rightAscensionHours >= 24) {
            throw new IllegalArgumentException("right ascension out of range: " + rightAscensionHours);
        }
        if (Math.abs(declinationDeg) > 90) {
            throw new IllegalArgumentException("declination out of range: " + declinationDeg);
        }
    }

    /** The angle between two points of the sky, in degrees. */
    public double separationDeg(Coordinates other) {
        double ra1 = Math.toRadians(rightAscensionHours * 15);
        double ra2 = Math.toRadians(other.rightAscensionHours * 15);
        double d1 = Math.toRadians(declinationDeg);
        double d2 = Math.toRadians(other.declinationDeg);
        double cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(ra1 - ra2);
        return Math.toDegrees(Math.acos(Math.min(1, Math.max(-1, cos))));
    }

    @Override
    public String toString() {
        return String.format("%.4fh %+.3f°", rightAscensionHours, declinationDeg);
    }
}
