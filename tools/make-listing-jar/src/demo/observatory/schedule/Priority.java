package demo.observatory.schedule;

public enum Priority {
    LOW(1), NORMAL(2), HIGH(4), URGENT(8);

    private final int weight;

    Priority(int weight) {
        this.weight = weight;
    }

    public int weight() {
        return weight;
    }
}
