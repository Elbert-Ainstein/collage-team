import { Navigate, Route, Routes } from "react-router-dom";
import "./app.css";
import { RoleRail } from "./RoleRail";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useStore } from "@/store";
import { Stub } from "@/routes/Stub";

// Student — M1 screens
import { MyActivities } from "@/routes/student/MyActivities";
import { Prep } from "@/routes/student/Prep";
import { OcrReview } from "@/routes/student/OcrReview";
import { PrepConfirm } from "@/routes/student/PrepConfirm";
// Student — M2 team stage
import { Discussion } from "@/routes/student/Discussion";
import { Collective } from "@/routes/student/Collective";
import { Participation } from "@/routes/student/Participation";
import { IndividualFinal } from "@/routes/student/IndividualFinal";

export function App() {
  const role = useStore((s) => s.role);
  return (
    <div className="app">
      <RoleRail />
      <Sidebar />
      <div className="main">
        <TopBar />
        <main className="content">
          <div className="content__inner">
            <Routes>
              <Route path="/" element={<Navigate to={role === "instructor" ? "/i/dashboard" : "/s/activities"} replace />} />

              {/* Instructor (M3/M4) */}
              <Route path="/i/dashboard" element={<Stub title="Course dashboard" milestone="M4" />} />
              <Route path="/i/library" element={<Stub title="Activity library" milestone="M4" />} />
              <Route path="/i/roster" element={<Stub title="Roster & import" milestone="M3" />} />
              <Route path="/i/teams" element={<Stub title="Team management" milestone="M3" />} />
              <Route path="/i/formation" element={<Stub title="Team formation" subtitle="Criteria-based team formation wizard." milestone="◇ deferred" />} />
              <Route path="/i/builder" element={<Stub title="Activity builder" milestone="M3" />} />
              <Route path="/i/ai" element={<Stub title="AI activity generation" milestone="◇ deferred" />} />
              <Route path="/i/rubric" element={<Stub title="Rubric builder" milestone="M3" />} />
              <Route path="/i/live" element={<Stub title="Live dashboard" milestone="M4" />} />
              <Route path="/i/oral/:teamId" element={<Stub title="Oral check-in" milestone="◇ deferred" />} />
              <Route path="/i/grading" element={<Stub title="Grading" milestone="M3" />} />
              <Route path="/i/results" element={<Stub title="Results & analytics" milestone="◇ deferred" />} />
              <Route path="/i/peer-eval" element={<Stub title="Peer evaluation" milestone="◇ deferred" />} />

              {/* Student */}
              <Route path="/s/activities" element={<MyActivities />} />
              <Route path="/s/prep" element={<Prep />} />
              <Route path="/s/ocr" element={<OcrReview />} />
              <Route path="/s/confirm" element={<PrepConfirm />} />
              <Route path="/s/discussion" element={<Discussion />} />
              <Route path="/s/collective" element={<Collective />} />
              <Route path="/s/individual" element={<IndividualFinal />} />
              <Route path="/s/participation" element={<Participation />} />
              <Route path="/s/grades" element={<Stub title="Grades & feedback" milestone="M3" />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
