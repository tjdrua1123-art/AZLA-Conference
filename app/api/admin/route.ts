export async function POST() {
  return Response.json(
    {
      error:
        "직원 계정 기능은 제거되었습니다. 팀 공유 링크로 회의를 작성해 주세요.",
    },
    { status: 410 },
  );
}
