import { summarizeTournament, type TournamentOptions } from "./tournamentRunner.js";

export async function runTournament(options: TournamentOptions) {
  const result = await summarizeTournament(options);
  console.log(result.text);
}

