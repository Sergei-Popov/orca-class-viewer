package demo.observatory.catalog;

public record Galaxy(String name, double apparentMagnitude, Coordinates position, Morphology morphology, double distanceMly)
        implements CelestialBody {
    public enum Morphology { SPIRAL, BARRED_SPIRAL, LENTICULAR, ELLIPTICAL, IRREGULAR }

    public boolean local() {
        return distanceMly < 10;
    }
}
