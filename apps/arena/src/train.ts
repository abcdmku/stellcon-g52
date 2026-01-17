import { runTraining, type TrainingOptions } from "./trainingRunner.js";

export async function trainHardStyle(options: TrainingOptions) {
  const result = await runTraining(options);
  console.log(result.text);
}

