export type CourseSettingsValidationField = "name" | "maxDrivers" | "cycles";

export type CourseSettingsValidationError = {
  field: CourseSettingsValidationField;
  message: string;
};

export function validateCourseSettings(input: {
  name: string;
  maxDrivers: string;
  usesCycles: boolean;
  cycleCount: number;
}): CourseSettingsValidationError[] {
  const errors: CourseSettingsValidationError[] = [];

  if (!input.name.trim()) {
    errors.push({ field: "name", message: "コース名を入力してください" });
  }

  if (!input.maxDrivers.trim()) {
    errors.push({ field: "maxDrivers", message: "いつもの1日の人数を入力してください" });
  } else {
    const maxDrivers = Number(input.maxDrivers);
    if (!Number.isInteger(maxDrivers) || maxDrivers < 1) {
      errors.push({ field: "maxDrivers", message: "いつもの1日の人数は1人以上で入力してください" });
    }
  }

  if (input.usesCycles && input.cycleCount === 0) {
    errors.push({ field: "cycles", message: "サイクルを1つ以上追加してください" });
  }

  return errors;
}
