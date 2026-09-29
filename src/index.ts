import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

type Env = { MORNING: Workflow; IMGS: R2Bucket; AUTOIP_TOKEN: string; LINE_TOKEN: string; LINE_TO: string; PUBLIC_BASE: string };

export class MorningImgs extends WorkflowEntrypoint<Env> {
  async run(_e: WorkflowEvent<{}>, step: WorkflowStep) {
    const auth = { Authorization: `Bearer ${this.env.AUTOIP_TOKEN}` };
    const prompt = await step.do("gen_prompt", async () => {
    // 把 n8n gen_prompt 的陣列與隨機組合邏輯原樣貼過來
    const scenes = [
      "luxurious modern bedroom with rumpled white silk sheets and soft morning window light",
      "high-end hotel suite with floor-to-ceiling windows and city view",
      "bright photography studio with soft lighting and minimal backdrop",
      "sunlit indoor poolside lounge with wet marble floor",
      "steamy luxury bathroom with large mirror and glass shower",
      "penthouse living room with large sofa and golden hour light"
    ];

    const poses = [
      "lying on her side with one knee bent, body arched, legs slightly parted, one hand lightly touching her breast",
      "sitting on the edge of furniture with back arched, legs apart, one hand on inner thigh",
      "standing with hip tilt, one arm raised, fully facing camera so breasts and genitals are clearly visible",
      "kneeling on the bed or sofa with knees apart, torso upright, looking at camera",
      "lying on her back with knees bent and legs open, one hand on breast, the other near her hip",
      "3/4 turn looking over her shoulder while sitting, body twisted to show breasts, waist and exposed genitals"
    ];

    const expressions = [
      "seductive half-lidded gaze with slightly parted lips",
      "teasing confident smile and direct eye contact",
      "soft smirk with a shy-yet-inviting look",
      "intense alluring stare, mouth slightly open",
      "relaxed sensual expression as if just waking up",
      "playful biting of the lower lip while looking at the camera"
    ];

    const lightings = [
      "soft natural morning window light with gentle shadows",
      "warm golden hour sunlight from the side",
      "bright clean studio softbox lighting",
      "moody warm indoor lamp light with contrast",
      "steamy diffused bathroom light with highlights on wet skin",
      "late afternoon rim light outlining the body"
    ];

    const hairstyles = [
      "long straight silky black hair falling over her shoulders",
      "long wavy dark hair slightly messy around her face",
      "long hair loosely tied with strands falling down",
      "sleek center-parted long black hair",
      "hair swept to one side exposing her neck and shoulder",
      "slightly damp long hair clinging to her skin"
    ];

    const framings = [
      "vertical 9:16 close-up from head to chest",
      "vertical 9:16 medium shot from head to waist",
      "vertical 9:16 medium shot from head to mid-thigh",
      "vertical 9:16 three-quarter shot from head to knees",
      "vertical 9:16 full body shot from head to feet",
      "vertical 9:16 tight medium shot emphasizing torso and hips"
    ];

    const backgroundObjects = [
      "a glass of water and a silk pillow nearby",
      "a folded white towel and a small vase of flowers",
      "a luxury handbag and scattered jewelry on a side table",
      "an open book and a warm table lamp",
      "a champagne glass and soft draped fabric",
      "a large mirror reflecting part of the room",
      "a potted plant and sheer curtains in the background",
      "a wooden chair with a discarded thin robe"
    ];

    const scene = scenes[Math.floor(Math.random() * scenes.length)];
    const pose = poses[Math.floor(Math.random() * poses.length)];
    const expression = expressions[Math.floor(Math.random() * expressions.length)];
    const lighting = lightings[Math.floor(Math.random() * lightings.length)];
    const hairstyle = hairstyles[Math.floor(Math.random() * hairstyles.length)];
    const framing = framings[Math.floor(Math.random() * framings.length)];
    const backgroundObject = backgroundObjects[Math.floor(Math.random() * backgroundObjects.length)];

    const finalPrompt = `Photorealistic hyperrealistic cinematic photograph of a young slim elegant Korean K-pop idol style woman in her early 20s, delicate natural face with slight asymmetry, visible pores and realistic skin texture, ${hairstyle}, ${expression}.
            Fully nude, completely naked, no clothing. Explicitly visible nipples, areolas and exposed genitals. Soft natural breasts, slim waist, toned long legs, detailed realistic skin on breasts, nipples and vulva.
            exactly two arms, exactly two hands, exactly two legs, exactly two feet, five fingers on each hand, anatomically correct body, natural limb placement, face clearly visible, breasts not covered.
            Scene: ${scene}.
            Background details: ${backgroundObject}.
            Pose: ${pose}.
            Lighting: ${lighting}.
            Technical: Canon EOS R5, 85mm f/1.4, shallow DOF, realistic shadows, film grain, 8K photorealistic skin, no artifacts.
            Composition: ${framing}.
            Avoid: extra arms, extra hands, extra fingers, extra legs, extra feet, third arm, third hand, third leg, fused fingers, mutated hands, deformed limbs, poorly drawn hands, extra limbs, missing limbs, bad anatomy, face not visible, hair covering breasts, arms covering chest.`;

      return finalPrompt;
});

    const taskId = await step.do("send_request", { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } }, async () => {
      const fd = new FormData();
      fd.append("prompt", prompt);
      fd.append("size", "540x960");
      fd.append("mode", "v3");
      const res = await fetch("https://autoip.app/api/v1/images/text-to-image", { method: "POST", headers: auth, body: fd });
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) {
          throw new NonRetryableError(`send ${res.status}: ${body}`);
        }
        throw new Error(`send ${res.status}: ${body}`);
      }
      const j: any = await res.json();
      return j.task_uuid as string;
    });

    let output: { download_url: string; filename: string } | null = null;
    for (let i = 0; i < 60 && !output; i++) {           // 最多等約 10 分鐘
      await step.sleep(`wait-${i}`, "10 seconds");
      const s = await step.do(`check_status-${i}`, async () => {
        const r = await fetch(`https://autoip.app/api/v1/tasks/${taskId}`, { headers: auth });
        const j: any = await r.json();
        return { status: j.status as string, out: j.outputs?.[0] ?? null };
      });
      if (s.status === "completed") output = s.out;
      else if (["failed", "timeout", "cancelled"].includes(s.status)) throw new Error(`task ${s.status}`);
    }
    if (!output) throw new Error("polling timeout");

    const key = await step.do("download_and_save", async () => {
      const r = await fetch(output!.download_url, { headers: auth });
      const buf = await r.arrayBuffer();
      const k = `morning/${Date.now()}.jpg`;
      await this.env.IMGS.put(k, buf, { httpMetadata: { contentType: r.headers.get("content-type") ?? "image/jpeg" } });
      return k;
    });

    await step.do("line_push", async () => {
      const url = `${this.env.PUBLIC_BASE}/${key}`;
      const r = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.env.LINE_TOKEN}` },
        body: JSON.stringify({
          to: this.env.LINE_TO,
          messages: [
             { type: "image", originalContentUrl: url, previewImageUrl: url }
          ],
        }),
      });
      if (!r.ok) throw new Error(`line ${r.status} ${await r.text()}`);
    });
  }
}

export default {
  async scheduled(_c: ScheduledController, env: Env) {
    await env.MORNING.create();
  },
  async fetch(req: Request, env: Env) {            // 取代 n8n 的手動執行
    if (new URL(req.url).pathname !== "/run") return new Response("ok");
    const inst = await env.MORNING.create();
    return Response.json({ id: inst.id });
  },
};