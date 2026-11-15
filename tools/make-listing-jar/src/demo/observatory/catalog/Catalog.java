package demo.observatory.catalog;

import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

/** Bodies by name, in the order they were added. */
public class Catalog<T extends CelestialBody & Comparable<? super T>> implements Iterable<T> {
    private final Map<String, Entry<T>> bodies = new LinkedHashMap<>();
    private transient volatile int version;

    public synchronized void add(T body) {
        bodies.put(body.name(), new Entry<>(body, version));
        version++;
    }

    public Optional<T> find(String name) {
        Entry<T> entry = bodies.get(name);
        return entry == null ? Optional.empty() : Optional.of(entry.body);
    }

    public <R> Map<String, R> map(Function<? super T, ? extends R> mapper) {
        Map<String, R> result = new LinkedHashMap<>();
        for (Map.Entry<String, Entry<T>> e : bodies.entrySet()) {
            result.put(e.getKey(), mapper.apply(e.getValue().body));
        }
        return Collections.unmodifiableMap(result);
    }

    public T nearest() {
        T best = null;
        for (Entry<T> entry : bodies.values()) {
            if (best == null || entry.body.compareTo(best) < 0) {
                best = entry.body;
            }
        }
        if (best == null) {
            throw new IllegalStateException("empty catalog");
        }
        return best;
    }

    public int size() {
        return bodies.size();
    }

    @Override
    public Iterator<T> iterator() {
        return bodies.values().stream().map(e -> e.body).iterator();
    }

    static final class Entry<T> {
        final T body;
        final int addedAt;

        Entry(T body, int addedAt) {
            this.body = body;
            this.addedAt = addedAt;
        }
    }
}
