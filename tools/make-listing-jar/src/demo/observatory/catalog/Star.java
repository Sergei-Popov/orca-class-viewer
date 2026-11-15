package demo.observatory.catalog;

import java.io.Serializable;

public record Star(String name, double apparentMagnitude, Coordinates position, SpectralClass spectralClass, double distanceLy)
        implements CelestialBody, Serializable, Comparable<Star> {
    private static final double LY_PER_PARSEC = 3.26156;

    /** The magnitude the star would have at 10 parsecs. */
    public double absoluteMagnitude() {
        double parsecs = distanceLy / LY_PER_PARSEC;
        return apparentMagnitude - 5 * (Math.log10(parsecs) - 1);
    }

    @Override
    public int compareTo(Star other) {
        return Double.compare(distanceLy, other.distanceLy);
    }
}
