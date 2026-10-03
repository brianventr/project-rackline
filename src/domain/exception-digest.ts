/** The morning note: up to three blocking problems, in the words the inbox already uses. */

export type DigestProblem = { title: string; detail: string };

export function exceptionDigest(input: {
  orgName: string;
  problems: DigestProblem[];
  appUrl: string | null;
}): { subject: string; text: string } {
  const shown = input.problems.slice(0, 3);
  const count = shown.length;
  const subject = count === 1 ? `1 thing needs you at ${input.orgName}` : `${count} things need you at ${input.orgName}`;
  const lines = shown.map((problem, index) => `${index + 1}. ${problem.title}\n${problem.detail}`);
  const link = input.appUrl ? `\n\nOpen Exceptions: ${input.appUrl.replace(/\/$/, "")}/exceptions` : "";
  return { subject, text: `${lines.join("\n\n")}${link}` };
}
