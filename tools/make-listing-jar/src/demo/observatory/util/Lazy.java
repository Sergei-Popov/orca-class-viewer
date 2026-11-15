package demo.observatory.util;

import java.util.function.Supplier;

/** A value computed on first use. */
public final class Lazy<T> implements Supplier<T> {
    private Supplier<? extends T> source;
    private T value;

    private Lazy(Supplier<? extends T> source) {
        this.source = source;
    }

    public static <T> Lazy<T> of(Supplier<? extends T> source) {
        return new Lazy<>(source);
    }

    @Override
    public synchronized T get() {
        if (source != null) {
            value = source.get();
            source = null;
        }
        return value;
    }
}
