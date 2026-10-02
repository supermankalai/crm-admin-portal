"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMoney } from "@/domain/money";
import { slugify } from "@/domain/slug";
import { cn } from "@/lib/utils";
import {
  gymDetailsSchema,
  ownerAccountSchema,
  planChoiceSchema,
  SUPPORTED_CURRENCIES,
  type GymDetailsInput,
  type OwnerAccountInput,
  type PlanChoiceInput,
} from "@/lib/validation/signup";
import { signupAction } from "./actions";

type Plan = {
  code: string;
  name: string;
  description: string;
  priceMonthlyMinor: number;
  currency: string;
  maxMembers: number;
  maxStaff: number;
  maxLocations: number;
  featureReports: boolean;
  featureCsvExport: boolean;
  featureClassBookings: boolean;
};

type StepKey = "gym" | "owner" | "plan";
const GYM_FIELDS = new Set(["gymName", "slug", "timezone", "currency"]);
const OWNER_FIELDS = new Set(["ownerName", "email", "password", "confirmPassword"]);

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function SignupWizard({
  plans,
  timezones,
  signedInAs,
}: {
  plans: Plan[];
  timezones: string[];
  signedInAs: { name: string; email: string } | null;
}) {
  const steps: { key: StepKey; label: string }[] = [
    { key: "gym", label: "Your gym" },
    ...(signedInAs ? [] : [{ key: "owner" as const, label: "Owner account" }]),
    { key: "plan", label: "Choose a plan" },
  ];
  const [stepIndex, setStepIndex] = useState(0);
  const [gym, setGym] = useState<GymDetailsInput | null>(null);
  const [owner, setOwner] = useState<OwnerAccountInput | null>(null);
  const [slugEdited, setSlugEdited] = useState(false);
  const [pending, startTransition] = useTransition();
  const step = steps[stepIndex].key;

  const gymForm = useForm<GymDetailsInput>({
    resolver: zodResolver(gymDetailsSchema),
    defaultValues: { gymName: "", slug: "", timezone: "Asia/Kolkata", currency: "INR" },
  });
  const ownerForm = useForm<OwnerAccountInput>({
    resolver: zodResolver(ownerAccountSchema),
    defaultValues: { ownerName: "", email: "", password: "", confirmPassword: "" },
  });
  const planForm = useForm<PlanChoiceInput>({
    resolver: zodResolver(planChoiceSchema),
    defaultValues: { planCode: plans[1]?.code ?? plans[0]?.code ?? "" },
  });

  const selectedPlan = useWatch({ control: planForm.control, name: "planCode" });

  const next = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const back = () => setStepIndex((i) => Math.max(i - 1, 0));

  const submit = (plan: PlanChoiceInput) => {
    if (!gym) return;
    startTransition(async () => {
      const result = await signupAction({ ...gym, ...(owner ?? {}), ...plan });
      if (result.ok) return; // the action redirects into the new gym
      const fieldErrors = result.fieldErrors ?? {};
      const fields = Object.keys(fieldErrors);
      for (const field of fields) {
        const message = fieldErrors[field]?.[0];
        if (!message) continue;
        if (GYM_FIELDS.has(field)) gymForm.setError(field as keyof GymDetailsInput, { message });
        else if (OWNER_FIELDS.has(field)) ownerForm.setError(field as keyof OwnerAccountInput, { message });
        else planForm.setError("planCode", { message });
      }
      if (fields.some((f) => GYM_FIELDS.has(f))) setStepIndex(0);
      else if (fields.some((f) => OWNER_FIELDS.has(f))) setStepIndex(steps.findIndex((s) => s.key === "owner"));
      toast.error(result.error);
    });
  };

  return (
    <div className="grid gap-6">
      <ol className="grid grid-cols-3 gap-2 text-sm" aria-label="Sign-up progress">
        {steps.map((s, i) => (
          <li
            key={s.key}
            aria-current={i === stepIndex ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2",
              i === stepIndex && "border-primary bg-primary/5 font-medium",
              i < stepIndex && "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                i < stepIndex && "border-primary bg-primary text-primary-foreground"
              )}
            >
              {i < stepIndex ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className="truncate">{s.label}</span>
          </li>
        ))}
      </ol>

      <Card>
        <CardContent>
          {step === "gym" && (
            <form
              noValidate
              className="grid gap-4"
              onSubmit={gymForm.handleSubmit((values) => {
                setGym(values);
                next();
              })}
            >
              <div className="grid gap-2">
                <Label htmlFor="gymName">Gym name</Label>
                <Input
                  id="gymName"
                  autoComplete="organization"
                  aria-invalid={!!gymForm.formState.errors.gymName}
                  aria-describedby="gymName-error"
                  {...gymForm.register("gymName", {
                    onChange: (e) => {
                      if (!slugEdited) gymForm.setValue("slug", slugify(e.target.value), { shouldValidate: false });
                    },
                  })}
                />
                <FieldError id="gymName-error" message={gymForm.formState.errors.gymName?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="slug">Your gym&apos;s address</Label>
                <div className="flex items-center rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                  <span className="pl-3 text-sm text-muted-foreground">fitcrm.app/g/</span>
                  <input
                    id="slug"
                    className="h-9 min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none"
                    aria-invalid={!!gymForm.formState.errors.slug}
                    aria-describedby="slug-error slug-hint"
                    {...gymForm.register("slug", { onChange: () => setSlugEdited(true) })}
                  />
                </div>
                <p id="slug-hint" className="text-xs text-muted-foreground">
                  Lowercase letters, numbers and hyphens. Used in every link to your gym.
                </p>
                <FieldError id="slug-error" message={gymForm.formState.errors.slug?.message} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="timezone">Time zone</Label>
                  <NativeSelect id="timezone" {...gymForm.register("timezone")}>
                    {timezones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replaceAll("_", " ")}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldError id="timezone-error" message={gymForm.formState.errors.timezone?.message} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="currency">Currency</Label>
                  <NativeSelect id="currency" {...gymForm.register("currency")}>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit">Continue</Button>
              </div>
            </form>
          )}

          {step === "owner" && (
            <form
              noValidate
              className="grid gap-4"
              onSubmit={ownerForm.handleSubmit((values) => {
                setOwner(values);
                next();
              })}
            >
              <div className="grid gap-2">
                <Label htmlFor="ownerName">Your full name</Label>
                <Input id="ownerName" autoComplete="name" aria-invalid={!!ownerForm.formState.errors.ownerName} aria-describedby="ownerName-error" {...ownerForm.register("ownerName")} />
                <FieldError id="ownerName-error" message={ownerForm.formState.errors.ownerName?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" aria-invalid={!!ownerForm.formState.errors.email} aria-describedby="email-error" {...ownerForm.register("email")} />
                <FieldError id="email-error" message={ownerForm.formState.errors.email?.message} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!ownerForm.formState.errors.password} aria-describedby="password-error password-hint" {...ownerForm.register("password")} />
                  <p id="password-hint" className="text-xs text-muted-foreground">At least 10 characters, with upper and lower case letters and a number.</p>
                  <FieldError id="password-error" message={ownerForm.formState.errors.password?.message} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input id="confirmPassword" type="password" autoComplete="new-password" aria-invalid={!!ownerForm.formState.errors.confirmPassword} aria-describedby="confirmPassword-error" {...ownerForm.register("confirmPassword")} />
                  <FieldError id="confirmPassword-error" message={ownerForm.formState.errors.confirmPassword?.message} />
                </div>
              </div>
              <div className="flex justify-between">
                <Button type="button" variant="outline" onClick={back}>
                  Back
                </Button>
                <Button type="submit">Continue</Button>
              </div>
            </form>
          )}

          {step === "plan" && (
            <form noValidate className="grid gap-4" onSubmit={planForm.handleSubmit(submit)}>
              <fieldset className="grid gap-3 md:grid-cols-3">
                <legend className="mb-3 text-sm font-medium">All plans start with a 14-day free trial</legend>
                {plans.map((plan) => {
                  const selected = selectedPlan === plan.code;
                  return (
                    <label
                      key={plan.code}
                      className={cn(
                        "relative flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                        selected ? "border-primary bg-primary/5" : "hover:bg-accent"
                      )}
                    >
                      <input type="radio" value={plan.code} className="sr-only" {...planForm.register("planCode")} />
                      <span className="flex items-center justify-between font-semibold">
                        {plan.name}
                        {selected && <Check className="size-4 text-primary" aria-hidden />}
                      </span>
                      <span className="text-xl font-bold">
                        {formatMoney(plan.priceMonthlyMinor, plan.currency)}
                        <span className="text-sm font-normal text-muted-foreground"> /month</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{plan.description}</span>
                      <ul className="mt-1 grid gap-1 text-sm">
                        <li>Up to {plan.maxMembers.toLocaleString()} members</li>
                        <li>{plan.maxStaff} staff accounts</li>
                        <li>{plan.maxLocations} location{plan.maxLocations > 1 ? "s" : ""}</li>
                        <li className={plan.featureClassBookings ? "" : "text-muted-foreground line-through"}>Class bookings</li>
                        <li className={plan.featureReports ? "" : "text-muted-foreground line-through"}>Reports</li>
                        <li className={plan.featureCsvExport ? "" : "text-muted-foreground line-through"}>CSV export</li>
                      </ul>
                    </label>
                  );
                })}
              </fieldset>
              <FieldError id="plan-error" message={planForm.formState.errors.planCode?.message} />
              {signedInAs && (
                <p className="text-sm text-muted-foreground">
                  You will be the owner of this gym, signed in as <span className="font-medium text-foreground">{signedInAs.email}</span>.
                </p>
              )}
              <div className="flex justify-between">
                <Button type="button" variant="outline" onClick={back} disabled={pending}>
                  Back
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" aria-hidden />} Create gym &amp; start trial
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
