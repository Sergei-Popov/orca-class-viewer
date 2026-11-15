package demo.observatory.telescope;

import demo.observatory.catalog.Coordinates;

/** What turns the tube: altitude-azimuth or equatorial. */
public sealed interface Mount permits AltAzMount, EquatorialMount {
    double latitudeDeg();

    /** The altitude of a target over the horizon now, in degrees. */
    double altitudeOf(Coordinates target);

    Slew slewTo(Coordinates target);
}
