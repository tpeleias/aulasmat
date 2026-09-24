import { describe, expect, it } from "vitest";
import { detectDelimiter, parseStudents, parseTable } from "@/lib/studentImport";

describe("parseTable", () => {
  it("respeita aspas com o separador dentro", () => {
    expect(parseTable('Bia,"Silva, Ana",Rua A\n', ",")).toEqual([["Bia", "Silva, Ana", "Rua A"], [""]]);
  });
  it("aspas duplicadas viram uma", () => {
    expect(parseTable('"Bia ""Bibi""";Ana', ";")[0]).toEqual(['Bia "Bibi"', "Ana"]);
  });
});

describe("detectDelimiter", () => {
  it("colado de planilha é TAB", () => expect(detectDelimiter("Bia\tAna\nCaio\tAna")).toBe("\t"));
  it("CSV do Excel em português é ponto e vírgula", () => expect(detectDelimiter("Bia;Ana, mãe\nCaio;Ana")).toBe(";"));
  it("senão, vírgula", () => expect(detectDelimiter("Bia,Ana\nCaio,Ana")).toBe(","));
});

describe("parseStudents", () => {
  it("sem cabeçalho: nome, responsável, endereço", () => {
    const r = parseStudents("Bia\tAna\tRua A, 10\nCaio\t\t", []);
    expect(r).toEqual([
      { student_name: "Bia", guardian_name: "Ana", address: "Rua A, 10", line: 1, status: "novo" },
      { student_name: "Caio", guardian_name: null, address: null, line: 2, status: "novo" },
    ]);
  });

  it("com cabeçalho, em qualquer ordem e com acento", () => {
    const r = parseStudents("Endereço;Responsável;Paciente\nRua B;Ana;Bia\n", []);
    expect(r).toEqual([{ student_name: "Bia", guardian_name: "Ana", address: "Rua B", line: 2, status: "novo" }]);
  });

  it("ignora linha sem nome e marca repetidos", () => {
    const r = parseStudents("Nome,Responsável\nBia,Ana\n,Ana\nbia , ana\nCaio,Ana\n", [
      { student_name: "Caio", guardian_name: "Ana" },
    ]);
    expect(r.map(x => [x.student_name, x.status])).toEqual([
      ["Bia", "novo"],
      ["bia", "repetido_na_planilha"],
      ["Caio", "repetido_no_cadastro"],
    ]);
  });

  it("CSV com BOM e fim de linha do Windows", () => {
    const r = parseStudents("﻿Nome;Responsável\r\nBia;Ana\r\n", []);
    expect(r).toHaveLength(1);
    expect(r[0].student_name).toBe("Bia");
  });
});
