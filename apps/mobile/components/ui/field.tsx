import { TextInput, type TextInputProps, View } from "react-native";
import { Text } from "@/components/ui/text";
import { COLORS } from "@/lib/theme";
import { cn } from "@/lib/utils";

type FieldProps = TextInputProps & { label: string; error?: string };

/** A labelled line to write on. */
export function Field({ label, error, className, ...props }: FieldProps) {
  return (
    <View className="gap-1.5">
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={COLORS.inkSoft}
        className={cn(
          "min-h-12 rounded border-ink border-ink bg-card px-3 font-body text-base text-ink",
          error && "border-tomato",
          className,
        )}
        {...props}
      />
      {error ? <Text className="font-medium text-sm text-tomato">{error}</Text> : null}
    </View>
  );
}
