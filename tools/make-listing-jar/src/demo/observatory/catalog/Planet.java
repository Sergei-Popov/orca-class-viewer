package demo.observatory.catalog;

public record Planet(String name, double apparentMagnitude, Coordinates position, int moons, boolean hasRings)
        implements CelestialBody {
    public static Planet of(String name, double magnitude, Coordinates position) {
        return new Planet(name, magnitude, position, 0, false);
    }
}
