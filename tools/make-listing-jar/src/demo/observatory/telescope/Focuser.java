package demo.observatory.telescope;

/** A motor focuser, counted in steps. */
public class Focuser {
    public enum Direction { IN, OUT }

    private final int maxSteps;
    private int position;

    public Focuser(int maxSteps) {
        this.maxSteps = maxSteps;
        this.position = maxSteps / 2;
    }

    public int move(Direction direction, int steps) {
        int next = switch (direction) {
            case IN -> position - steps;
            case OUT -> position + steps;
        };
        position = Math.max(0, Math.min(maxSteps, next));
        return position;
    }

    public int position() {
        return position;
    }
}
