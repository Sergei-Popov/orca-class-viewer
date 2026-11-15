package demo.observatory.catalog;

/** Anything a telescope can point at. */
public sealed interface CelestialBody permits Planet, Star, Galaxy, Nebula, Comet {
    String name();

    double apparentMagnitude();

    Coordinates position();

    default boolean nakedEye() {
        return apparentMagnitude() <= 6.0;
    }
}
