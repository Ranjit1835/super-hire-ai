// Placeholder for a drive's interview step; track C replaces this page.
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { V1Shell, Empty } from "../layout/V1Shell";

export default function InterviewPlaceholder() {
  const { driveId } = useParams();
  return (
    <V1Shell title="AI interview">
      <Empty title="Interview step coming in this drive" body="Your placement office will let you know when the interview opens.">
        <Button asChild variant="outline"><Link to={`/learn/v1/drives/${driveId}`}>Back to the drive</Link></Button>
      </Empty>
    </V1Shell>
  );
}
