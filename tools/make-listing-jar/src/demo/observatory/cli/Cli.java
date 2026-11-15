package demo.observatory.cli;

import demo.observatory.Observatory;
import demo.observatory.Version;
import demo.observatory.imaging.Stacker;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Parses the command line and runs the command it names. */
public final class Cli {
    /** A {@code --name=value} option. */
    public record Option(String name, String value) {
        static Option parse(String arg) {
            int eq = arg.indexOf('=');
            return eq < 0 ? new Option(arg.substring(2), "true") : new Option(arg.substring(2, eq), arg.substring(eq + 1));
        }
    }

    private final Observatory observatory;
    private final Console console;

    public Cli(Observatory observatory, Console console) {
        this.observatory = observatory;
        this.console = console;
    }

    public ExitCode run(String[] args) {
        if (args.length == 0 || args[0].equals("--version")) {
            console.println(Version.text());
            return args.length == 0 ? ExitCode.USAGE : ExitCode.OK;
        }
        try {
            return parse(args).run(observatory, console);
        } catch (IllegalArgumentException | DateTimeParseException e) {
            console.error(e.getMessage());
            return ExitCode.USAGE;
        }
    }

    Command parse(String[] args) {
        List<String> words = new ArrayList<>();
        List<Option> options = new ArrayList<>();
        for (String arg : Arrays.copyOfRange(args, 1, args.length)) {
            if (arg.startsWith("--")) {
                options.add(Option.parse(arg));
            } else {
                words.add(arg);
            }
        }
        return switch (args[0]) {
            case "observe" -> new ObserveCommand(first(words, "star"), number(options, "exposure", 60));
            case "plan" -> new PlanCommand(LocalDate.parse(first(words, "date")), (int) number(options, "max", 8));
            case "stack" -> new StackCommand(words, Stacker.Method.valueOf(text(options, "method", "MEDIAN")));
            default -> throw new IllegalArgumentException("unknown command: " + args[0]);
        };
    }

    private static String first(List<String> words, String what) {
        if (words.isEmpty()) {
            throw new IllegalArgumentException("missing " + what);
        }
        return words.get(0);
    }

    private static double number(List<Option> options, String name, double fallback) {
        for (Option option : options) {
            if (option.name().equals(name)) {
                return Double.parseDouble(option.value());
            }
        }
        return fallback;
    }

    private static String text(List<Option> options, String name, String fallback) {
        return options.stream().filter(o -> o.name().equals(name)).map(Option::value).findFirst().orElse(fallback);
    }
}
