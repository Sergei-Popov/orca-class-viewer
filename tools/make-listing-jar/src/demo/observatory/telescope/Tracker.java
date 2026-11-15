package demo.observatory.telescope;

import demo.observatory.util.Clock;
import demo.observatory.util.Ring;
import java.time.Duration;
import java.time.Instant;

/** Guiding: small corrections that keep a star on the same pixel. */
public class Tracker {
    private final Clock clock;
    private final Ring<double[]> corrections = new Ring<>(64);
    private Instant started;

    public Tracker(Clock clock) {
        this.clock = clock;
    }

    public void start() {
        started = clock.now();
    }

    public void correct(double raArcsec, double decArcsec) {
        corrections.add(new double[] {raArcsec, decArcsec});
    }

    /** The root mean square of the recent corrections, in arcseconds. */
    public double rms() {
        double sum = 0;
        int n = 0;
        for (double[] c : corrections) {
            sum += c[0] * c[0] + c[1] * c[1];
            n++;
        }
        return n == 0 ? 0 : Math.sqrt(sum / n);
    }

    public Duration running() {
        return started == null ? Duration.ZERO : Duration.between(started, clock.now());
    }
}
