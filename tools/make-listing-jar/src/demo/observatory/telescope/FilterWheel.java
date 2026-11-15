package demo.observatory.telescope;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Filters in front of the camera, one slot at a time. */
public class FilterWheel {
    public record Slot(int index, String filter) {}

    private final List<Slot> slots = new ArrayList<>();
    private int current;

    public FilterWheel(int size) {
        for (int i = 0; i < size; i++) {
            slots.add(new Slot(i, "empty"));
        }
    }

    public void load(int index, String filter) {
        slots.set(index, new Slot(index, filter));
    }

    public Optional<Slot> select(String filter) {
        for (Slot slot : slots) {
            if (slot.filter().equalsIgnoreCase(filter)) {
                current = slot.index();
                return Optional.of(slot);
            }
        }
        return Optional.empty();
    }

    public Slot current() {
        return slots.get(current);
    }
}
