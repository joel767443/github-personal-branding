-- Add profile/job/hireability fields to developers
ALTER TABLE developers
ADD COLUMN profile_pic TEXT;

ALTER TABLE developers
ADD COLUMN job_title TEXT;

ALTER TABLE developers
ADD COLUMN hireable BOOLEAN;

