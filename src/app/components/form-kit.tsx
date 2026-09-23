import { useEffect, useId, type ComponentProps, type HTMLInputTypeAttribute, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  get,
  useFieldArray,
  useForm,
  useFormState,
  type ArrayPath,
  type ControllerRenderProps,
  type DefaultValues,
  type FieldArray,
  type FieldError,
  type FieldPath,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";
import { Plus, X } from "lucide-react";
import { Button as IconButton } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { blankLine } from "@/domain/form-schemas";
import { Button, Input } from "./ui";

/*
 * Inline validation for create and edit sheets: react-hook-form + a zod schema from
 * `src/domain/form-schemas.ts`, drawn with the shadcn form primitives.
 *
 *   const form = useZodForm(orderFormSchema, { customerName: "", shipToAddress: "", lines: [blankLine()] });
 *   <FormSheet onSubmit={form.handleSubmit(save)} …>
 *     <TextField form={form} name="customerName" label="Customer" autoFocus />
 *     <LinesField form={form} name="lines" items={items} />
 *   </FormSheet>
 *
 * Errors show under the field when it loses focus and again on submit, then clear as you fix them.
 * When focus leaves because a button was pressed (Add line, Remove line), the blur check waits for
 * the click, so the message cannot push the button away before it lands.
 * `save` gets the schema's output (numbers already coerced, blank line rows dropped). Server errors
 * still go to the sheet's `error` banner.
 */

/** Form values a schema accepts (what the inputs hold). */
export type ZodFormInput<S extends z.ZodType> = Extract<z.input<S>, FieldValues>;
/** What `handleSubmit` hands to the save function. */
export type ZodFormOutput<S extends z.ZodType> = z.output<S>;
export type ZodForm<S extends z.ZodType> = UseFormReturn<ZodFormInput<S>, unknown, ZodFormOutput<S>>;

/** Any form built by `useZodForm` (the field components only need its values type). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm<T extends FieldValues> = UseFormReturn<T, any, any>;

export function useZodForm<S extends z.ZodType>(schema: S, defaultValues: z.input<S>): ZodForm<S> {
  return useForm<ZodFormInput<S>, unknown, ZodFormOutput<S>>({
    // The resolver's overloads cannot see through a generic schema; the types line up at the call site.
    resolver: zodResolver(schema as never) as unknown as Resolver<ZodFormInput<S>, unknown, ZodFormOutput<S>>,
    defaultValues: defaultValues as DefaultValues<ZodFormInput<S>>,
    // Validate a field the first time it loses focus, then on every change; everything on submit.
    mode: "onTouched",
    reValidateMode: "onChange",
  });
}

/*
 * A blur check can draw a message under a field and push the rest of the sheet down. When the blur
 * comes from pressing a button further down (Add line, Remove line, a checkbox, a scan button), the
 * button moves before the mouse or finger comes up and the click is lost. So while such a press is
 * held, kit fields hold their blur check and run it just after the click has landed. Presses on
 * controls that take focus themselves (text inputs, selects) are not held: they have no click to
 * lose, and a native select's popup can swallow the release. Tab still checks at once.
 */
const TAKES_FOCUS_ON_PRESS =
  'select, textarea, [contenteditable]:not([contenteditable="false"]), input:not([type="button"], [type="submit"], [type="reset"], [type="checkbox"], [type="radio"], [type="file"], [type="image"], [type="color"])';

let pressHeld = false;
/** Each kit control's current onBlur, refreshed by its ref on every render. */
const latestBlur = new WeakMap<Node, () => void>();
let heldBlurs: (() => void)[] = [];
let watchingPresses = false;

function pressStarted(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  pressHeld = !target?.closest(TAKES_FOCUS_ON_PRESS);
}

/** Pointer or key released (or the window lost focus): run the held checks after this event's click. */
function pressEnded() {
  pressHeld = false;
  if (!heldBlurs.length) return;
  const run = heldBlurs;
  heldBlurs = [];
  // pointerup, mouseup and click go out together, so a zero timeout runs after the click handler.
  window.setTimeout(() => run.forEach((blur) => blur()), 0);
}

function watchPresses() {
  if (watchingPresses) return;
  watchingPresses = true;
  for (const type of ["pointerdown", "mousedown"]) document.addEventListener(type, pressStarted, true);
  for (const type of ["pointerup", "mouseup", "pointercancel", "dragend", "contextmenu", "keydown"]) {
    document.addEventListener(type, pressEnded, true);
  }
  window.addEventListener("blur", pressEnded);
}

/** Start listening for presses before the first one can blur a kit field. */
function useHeldBlurs() {
  useEffect(watchPresses, []);
}

/** Wrap a field's onBlur (RHF reads the value itself, so it can run later) as described above. */
function heldBlur(onBlur: () => void) {
  return (event: { currentTarget: Node }) => {
    if (!pressHeld) {
      onBlur();
      return;
    }
    const element = event.currentTarget;
    heldBlurs.push(() => {
      // The click removed this field (Remove line, closing the sheet) or put the cursor back in it.
      if (!element.isConnected || element === document.activeElement) return;
      // Take the handler from the latest render: removing an earlier row renames this one (lines.2 -> lines.1).
      (latestBlur.get(element) ?? onBlur)();
    });
  };
}

/**
 * Zod owns validation, so the surrounding `<form>` (usually `FormSheet`'s) must not run the browser's
 * own checks first: `type="number"` alone blocks submit on "1.5" with a native bubble, and RHF never
 * gets to show the inline message. Each kit control switches it off on its form as it mounts.
 * Convert every field in a sheet, not half of them, since plain `required` inputs lose their check too.
 */
function kitRef(field: { ref: (instance: unknown) => void; onBlur: () => void }) {
  return (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) => {
    field.ref(element);
    if (!element) return;
    latestBlur.set(element, field.onBlur);
    if (element.form && !element.form.noValidate) element.form.noValidate = true;
  };
}

/**
 * The house native `<select>` (same look as `Select` in ./ui) that also takes a ref, so submit can
 * focus the first bad field, and turns red while it holds an error like the shadcn Input does.
 */
function FieldSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "border-input h-8 w-full rounded-md border bg-card px-2 py-0.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
    />
  );
}

type BaseFieldProps<T extends FieldValues> = {
  form: AnyForm<T>;
  name: FieldPath<T>;
  label: string;
  description?: ReactNode;
  className?: string;
};

function FieldShell<T extends FieldValues>({
  form,
  name,
  label,
  description,
  className,
  control,
}: BaseFieldProps<T> & {
  control: (field: ControllerRenderProps<FieldValues, string>) => ReactNode;
}) {
  useHeldBlurs();
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem className={cn("text-sm", className)}>
            <FormLabel>{label}</FormLabel>
            <FormControl>{control(field as unknown as ControllerRenderProps<FieldValues, string>)}</FormControl>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  );
}

function textValue(value: unknown): string {
  return value == null ? "" : String(value);
}

export function TextField<T extends FieldValues>({
  placeholder,
  autoFocus,
  type = "text",
  autoComplete,
  ...props
}: BaseFieldProps<T> & {
  placeholder?: string;
  autoFocus?: boolean;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
}) {
  return (
    <FieldShell
      {...props}
      control={(field) => (
        <Input
          {...field}
          ref={kitRef(field)}
          onBlur={heldBlur(field.onBlur)}
          value={textValue(field.value)}
          type={type}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
        />
      )}
    />
  );
}

export function NumberField<T extends FieldValues>({
  min,
  max,
  step,
  placeholder,
  ...props
}: BaseFieldProps<T> & { min?: number; max?: number; step?: number | "any"; placeholder?: string }) {
  return (
    <FieldShell
      {...props}
      control={(field) => (
        <Input
          {...field}
          ref={kitRef(field)}
          onBlur={heldBlur(field.onBlur)}
          value={textValue(field.value)}
          type="number"
          inputMode={step === undefined || step === 1 ? "numeric" : "decimal"}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
        />
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  options,
  placeholder,
  ...props
}: BaseFieldProps<T> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <FieldShell
      {...props}
      control={(field) => (
        <FieldSelect
          name={field.name}
          ref={kitRef(field)}
          value={textValue(field.value)}
          onChange={(event) => field.onChange(event.target.value)}
          onBlur={heldBlur(field.onBlur)}
          disabled={field.disabled}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FieldSelect>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  placeholder,
  rows,
  ...props
}: BaseFieldProps<T> & { placeholder?: string; rows?: number }) {
  return (
    <FieldShell
      {...props}
      control={(field) => (
        <Textarea
          name={field.name}
          ref={kitRef(field)}
          value={textValue(field.value)}
          onChange={(event) => field.onChange(event.target.value)}
          onBlur={heldBlur(field.onBlur)}
          disabled={field.disabled}
          placeholder={placeholder}
          rows={rows}
        />
      )}
    />
  );
}

type LineRowErrors = { itemId?: FieldError; qty?: FieldError };

/**
 * SKU + qty rows with add and remove. Pair it with `linesSchema` (orders) or `uniqueLinesSchema`
 * (receipts, purchases, returns, ASNs): rows without a SKU are dropped on submit, a row with a SKU
 * needs a qty of 1 or more, and each row shows its own error under it.
 */
export function LinesField<T extends FieldValues>({
  form,
  name,
  label = "Lines",
  items,
}: {
  form: AnyForm<T>;
  name: ArrayPath<T>;
  label?: string;
  items: { id: string; sku: string; name: string }[];
}) {
  const baseId = useId();
  useHeldBlurs();
  const { fields, append, remove } = useFieldArray<T, ArrayPath<T>>({ control: form.control, name });
  const { errors, isSubmitted } = useFormState({ control: form.control, name: name as unknown as FieldPath<T> });
  const arrayErrors = get(errors, name) as (LineRowErrors | undefined)[] & { root?: FieldError; message?: string } | undefined;
  const listMessage = arrayErrors?.root?.message ?? (typeof arrayErrors?.message === "string" ? arrayErrors.message : undefined);
  const labelId = `${baseId}-label`;

  /** Once the form has been submitted (or a row already shows an error), re-check every row, so
   * fixing a repeated SKU on one line clears the message on the other. */
  function recheck() {
    if (isSubmitted || get(form.formState.errors, name)) void form.trigger(name as unknown as FieldPath<T>);
  }

  return (
    <div role="group" aria-labelledby={labelId} className="space-y-1.5 text-sm">
      <p id={labelId} className="font-medium">
        {label}
      </p>
      <div className="space-y-2">
        <div aria-hidden className="grid grid-cols-[minmax(0,1fr)_5rem_1.75rem] gap-2 text-xs text-muted-foreground">
          <span>SKU</span>
          <span>Qty</span>
          <span />
        </div>
        {fields.map((row, index) => {
          const rowErrors = arrayErrors?.[index];
          const messages = [rowErrors?.itemId?.message, rowErrors?.qty?.message].filter(
            (message): message is string => typeof message === "string" && message.length > 0,
          );
          const messageId = `${baseId}-row-${index}-message`;
          const itemPath = `${name}.${index}.itemId` as FieldPath<T>;
          const qtyPath = `${name}.${index}.qty` as FieldPath<T>;
          return (
            <div key={row.id} className="space-y-1">
              <div className="grid grid-cols-[minmax(0,1fr)_5rem_1.75rem] items-center gap-2">
                <Controller
                  control={form.control}
                  name={itemPath}
                  render={({ field, fieldState }) => (
                    <FieldSelect
                      name={field.name}
                      ref={kitRef(field)}
                      aria-label={`Line ${index + 1} SKU`}
                      aria-invalid={fieldState.invalid || undefined}
                      aria-describedby={fieldState.invalid ? messageId : undefined}
                      value={textValue(field.value)}
                      onChange={(event) => {
                        field.onChange(event.target.value);
                        recheck();
                      }}
                      onBlur={heldBlur(field.onBlur)}
                    >
                      <option value="">Select SKU</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.sku} — {item.name}
                        </option>
                      ))}
                    </FieldSelect>
                  )}
                />
                <Controller
                  control={form.control}
                  name={qtyPath}
                  render={({ field, fieldState }) => (
                    <Input
                      name={field.name}
                      ref={kitRef(field)}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      aria-label={`Line ${index + 1} qty`}
                      aria-invalid={fieldState.invalid || undefined}
                      aria-describedby={fieldState.invalid ? messageId : undefined}
                      value={textValue(field.value)}
                      onChange={(event) => field.onChange(event.target.value)}
                      onBlur={heldBlur(field.onBlur)}
                    />
                  )}
                />
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove line ${index + 1}`}
                  disabled={fields.length === 1}
                  onClick={() => {
                    remove(index);
                    recheck();
                  }}
                >
                  <X />
                </IconButton>
              </div>
              {messages.length ? (
                <p id={messageId} data-slot="form-message" className="text-xs leading-snug text-tone-danger">
                  {messages.join(" ")}
                </p>
              ) : null}
            </div>
          );
        })}
        {listMessage ? (
          <p data-slot="form-message" className="text-xs leading-snug text-tone-danger">
            {listMessage}
          </p>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            append(blankLine() as FieldArray<T, ArrayPath<T>>, {
              shouldFocus: true,
              focusName: `${name}.${fields.length}.itemId`,
            })
          }
        >
          <Plus className="size-4" />
          Add line
        </Button>
      </div>
    </div>
  );
}
