// ハコ虎AI のプロバイダ束縛点。
// LLM を使う機能はここから取得したクライアントを使う（route から SDK を直接 import しない）。
// キーはサーバー環境変数のみ（ANTHROPIC_API_KEY / OPENAI_API_KEY）。クライアントには一切露出しない。
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  if (!openai) openai = new OpenAI();
  return openai;
}
