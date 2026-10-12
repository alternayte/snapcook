import type { DeviceCapabilities, DeviceStep } from "./corpus";

export type StepProblem = { code: string; message: string };

/**
 * Checks a list of steps against what the device can do: indexes, settings on device steps
 * only, minutes on timed steps, and every limit of temperature, speed, reverse, whisk and time.
 */
export function deviceStepProblems(steps: DeviceStep[], device: DeviceCapabilities): StepProblem[] {
  const problems: StepProblem[] = [];
  const add = (code: string, message: string) => problems.push({ code, message });
  steps.forEach((step, i) => {
    if (step.index !== i)
      add(
        "step_index",
        `Step ${i} has index ${step.index}. Indexes start at 0 and count up by one.`,
      );
    if ((step.kind === "mc") !== (step.mc !== undefined)) {
      add(
        "device_settings",
        `Step ${i}: a device step needs its settings, and only a device step may have them.`,
      );
    }
    if ((step.kind === "pan" || step.kind === "oven") && step.minutes === undefined) {
      add(
        "missing_minutes",
        `Step ${i} is a ${step.kind} step with no minutes. Give minutes for every timed step.`,
      );
    }
    const mc = step.mc;
    if (!mc) return;
    if (step.minutes !== mc.minutes) {
      add(
        "device_minutes",
        `Step ${i}: the step's minutes and the device settings' minutes must be the same number.`,
      );
    }
    if (mc.temp_c < device.temp_c.min || mc.temp_c > device.temp_c.max) {
      add(
        "device_temp",
        `Step ${i}: ${mc.temp_c} °C is outside the device range ${device.temp_c.min} to ${device.temp_c.max} °C.`,
      );
    }
    if (mc.speed < device.speed.min || mc.speed > device.speed.max) {
      add(
        "device_speed",
        `Step ${i}: speed ${mc.speed} is outside the device range ${device.speed.min} to ${device.speed.max}.`,
      );
    }
    if (mc.reverse && mc.speed > device.reverse_max_speed) {
      add(
        "device_reverse",
        `Step ${i}: reverse works only up to speed ${device.reverse_max_speed}.`,
      );
    }
    if (mc.accessory === "butterfly" && mc.speed > device.whisk_max_speed) {
      add(
        "device_whisk",
        `Step ${i}: the butterfly whisk works only up to speed ${device.whisk_max_speed}.`,
      );
    }
    const limit = device.time_limits.find((l) => mc.speed <= l.up_to_speed);
    if (limit && mc.minutes > limit.max_minutes) {
      add(
        "device_time",
        `Step ${i}: ${mc.minutes} min at speed ${mc.speed} is over the device limit of ${limit.max_minutes} min. Split the step.`,
      );
    }
  });
  return problems;
}
