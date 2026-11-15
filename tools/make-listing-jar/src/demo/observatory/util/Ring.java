package demo.observatory.util;

import java.util.Iterator;
import java.util.NoSuchElementException;

/** The last N values added, oldest first. */
public final class Ring<T> implements Iterable<T> {
    private final Object[] items;
    private int start;
    private int size;

    public Ring(int capacity) {
        items = new Object[capacity];
    }

    public void add(T item) {
        if (size < items.length) {
            items[(start + size++) % items.length] = item;
        } else {
            items[start] = item;
            start = (start + 1) % items.length;
        }
    }

    public int size() {
        return size;
    }

    @SuppressWarnings("unchecked")
    public T get(int index) {
        if (index < 0 || index >= size) {
            throw new IndexOutOfBoundsException(index);
        }
        return (T) items[(start + index) % items.length];
    }

    @Override
    public Iterator<T> iterator() {
        return new Cursor();
    }

    private final class Cursor implements Iterator<T> {
        private int next;

        @Override
        public boolean hasNext() {
            return next < size;
        }

        @Override
        public T next() {
            if (!hasNext()) {
                throw new NoSuchElementException();
            }
            return get(next++);
        }
    }
}
