package demo.observatory.net;

import java.io.IOException;
import java.util.concurrent.Callable;
import java.util.logging.Logger;

/** Tries again after a growing pause. */
public final class Retry {
    private static final Logger LOG = Logger.getLogger(Retry.class.getName());

    private final int attempts;
    private final long firstPauseMs;

    public Retry(int attempts, long firstPauseMs) {
        if (attempts < 1) {
            throw new IllegalArgumentException("attempts: " + attempts);
        }
        this.attempts = attempts;
        this.firstPauseMs = firstPauseMs;
    }

    public <T> T run(Callable<T> call) throws IOException, InterruptedException {
        IOException last = null;
        long pause = firstPauseMs;
        for (int i = 1; i <= attempts; i++) {
            try {
                return call.call();
            } catch (IOException e) {
                last = e;
                LOG.warning("attempt " + i + " of " + attempts + " failed: " + e.getMessage());
                Thread.sleep(pause);
                pause *= 2;
            } catch (Exception e) {
                throw new IOException(e);
            }
        }
        throw last;
    }
}
