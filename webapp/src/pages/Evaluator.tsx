import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { toast } from "react-hot-toast";
import { FaSpinner } from "react-icons/fa";
import { useAppContext } from "../contexts/AppContext";
import { PrizeDetails, State, Contribution } from "../lib/types";
import ManagementCard from "../components/ManagementCard";
import StatusItem from "../components/StatusItem";
import ContributionSelect from "../components/ContributionSelect";
import ContributionDetails from "../components/ContributionDetails";
import EvaluationCriteria from "../components/EvaluationCriteria";
import { motion } from "framer-motion";

const AlreadyEvaluatedBanner: React.FC = () => (
  <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4" role="alert">
    <p className="font-bold">Note:</p>
    <p>This contribution has already been evaluated. You cannot submit another evaluation for it.</p>
  </div>
);

const Evaluator: React.FC = () => {
  const { prizeId } = useParams<{ prizeId: string }>();
  const { address, isConnected } = useAccount();
  const { prizeDiamond, isPrizesLoading } = useAppContext();

  const [prize, setPrize] = useState<PrizeDetails | null>(null);
  const [isEvaluator, setIsEvaluator] = useState<boolean>(false);
  const [weights, setWeights] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [selectedContribution, setSelectedContribution] = useState<Contribution | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [evaluatedContributions, setEvaluatedContributions] = useState<bigint[]>([]);

  const parsedPrizeId = useMemo(() => {
    try {
      return BigInt(prizeId || "0");
    } catch (e) {
      console.error("Invalid prizeId:", e);
      return 0n;
    }
  }, [prizeId]);

  const fetchPrizeDetails = useCallback(async () => {
    console.log("Fetching prize details...");
    if (!parsedPrizeId || !prizeDiamond) return;

    setIsLoading(true);
    try {
      const [prizeDetails, fetchedWeights, isEvaluatorResult, contributionCount, evaluatedIds] = await Promise.all([
        prizeDiamond.getPrizeDetails(parsedPrizeId),
        prizeDiamond.getCriteriaWeights(parsedPrizeId),
        address ? prizeDiamond.isPrizeEvaluator(parsedPrizeId, address) : false,
        prizeDiamond.getContributionCount(parsedPrizeId),
        address ? prizeDiamond.getEvaluatedContributions(parsedPrizeId, address) : [],
      ]);

      setPrize(prizeDetails);
      setWeights(fetchedWeights);
      setIsEvaluator(isEvaluatorResult);
      setEvaluatedContributions(evaluatedIds);

      const fetchedContributions = await Promise.all(
        Array.from({ length: Number(contributionCount) }, (_, i) =>
          prizeDiamond.getContribution(parsedPrizeId, BigInt(i)),
        ),
      );
      setContributions(fetchedContributions);
    } catch (error) {
      console.error("Error fetching prize details:", error);
      setError("Failed to fetch prize details. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  }, [parsedPrizeId, prizeDiamond, address]);

  useEffect(() => {
    console.log("Effect running. parsedPrizeId:", parsedPrizeId, "isPrizesLoading:", isPrizesLoading);
    if (parsedPrizeId && !isPrizesLoading) {
      fetchPrizeDetails();
    }
  }, [parsedPrizeId, isPrizesLoading, fetchPrizeDetails]);

  const handleContributionChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const selectedId = event.target.value;
      const selected = contributions.find((c) => c.id?.toString() === selectedId) || null;
      setSelectedContribution(selected);
      setScores(new Array(prize?.criteriaNames.length || 0).fill(5));
    },
    [contributions, prize],
  );

  const handleScoreChange = useCallback(
    (index: number, value: number) => {
      const newScores = [...scores];
      newScores[index] = value;
      setScores(newScores);
    },
    [scores],
  );

  const isFormValid = useCallback(() => {
    if (!prize || !selectedContribution) return false;
    return (
      scores.length === prize.criteriaNames.length &&
      scores.every((score) => score >= 1 && score <= 10) &&
      !evaluatedContributions.includes(selectedContribution.id ?? BigInt(0))
    );
  }, [prize, scores, selectedContribution, evaluatedContributions]);

  const handleSubmitEvaluation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isFormValid() || !prize || !selectedContribution) return;
    try {
      setIsSubmitting(true);
      if (!prizeDiamond.fhenixClient) {
        throw new Error("Fhenix client is not available. Please try again in a moment.");
      }
      const encrypted = await prizeDiamond.encryptScores(scores);
      await prizeDiamond.evaluateContributionAsync({
        prizeId: parsedPrizeId,
        contributionId: selectedContribution.id ?? 0n,
        encryptedScores: encrypted,
      });
      toast.success("Evaluation submitted successfully");
      await fetchPrizeDetails();
      setSelectedContribution(null);
      setScores([]);
    } catch (error) {
      console.error("Error submitting evaluation:", error);
      toast.error(`Failed to submit evaluation: ${(error as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="container mx-auto px-4 py-8 bg-gradient-to-br from-primary-800 to-primary-900 min-h-screen text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Wallet Not Connected</h1>
          <p className="mb-4">Please connect your wallet to access the Evaluator page.</p>
          <Link to="/" className="button-primary">
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <FaSpinner className="animate-spin text-purple-600 text-4xl" />
      </div>
    );
  }

  if (error) {
    return <div className="flex justify-center items-center h-screen text-red-500 text-2xl">{error}</div>;
  }

  if (!prize) {
    return <div className="flex justify-center items-center h-screen text-white text-2xl">Prize not found</div>;
  }

  if (!isEvaluator) {
    return (
      <div className="container mx-auto px-4 py-8 bg-gradient-to-br from-primary-800 to-primary-900 min-h-screen text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Not an Evaluator</h1>
          <p className="mb-4">You are not an evaluator for this prize.</p>
          <Link to={`/prize/${prizeId}`} className="button-primary">
            Back to Prize
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 bg-gradient-to-br from-primary-100 via-primary-300 to-primary-500 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center mb-4">
          <Link to={`/prize/${prizeId}`} className="text-primary-700 hover:underline">
            Back to Prize
          </Link>
        </div>

        <h1 className="text-5xl font-bold mb-8 text-center text-primary-900">Evaluator: {prize.name}</h1>

        <ManagementCard title="Prize Details" className="mt-12 mb-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-white">
            <StatusItem label="Organizer" value={prize.organizer} />
            <StatusItem label="Created At" value={new Date(Number(prize.createdAt) * 1000).toLocaleDateString()} />
            <StatusItem label="State" value={State[prize.state]} />
            <StatusItem label="Contributions" value={prize.contributionCount.toString()} />
            <StatusItem label="Evaluated Contributions" value={prize.evaluatedContributionsCount.toString()} />
          </div>
        </ManagementCard>

        <ManagementCard title="Criteria Weights">
          {prize.criteriaNames.length > 1 ? (
            <div className="space-y-4">
              {prize.criteriaNames.map((name, index) => (
                <div key={index} className="flex justify-between items-center">
                  <span className="text-white">{name}:</span>
                  <span className="text-accent-300 font-semibold">{weights[index] || 0}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-accent-300">This prize has only one criterion.</p>
          )}
        </ManagementCard>

        {prize.state === State.Evaluating && (
          <ManagementCard title="Evaluate Contributions">
            <div className="mb-8">
              <h2 className="text-2xl font-semibold mb-2">Progress</h2>
              <div className="bg-white rounded-full h-4">
                <div
                  className="bg-green-400 h-4 rounded-full transition-all duration-500 ease-in-out"
                  style={{
                    width: `${(evaluatedContributions.length / contributions.length) * 100}%`,
                  }}
                ></div>
              </div>
              <p className="text-sm mt-2">
                {evaluatedContributions.length} out of {contributions.length} contributions evaluated
              </p>
            </div>
            <form onSubmit={handleSubmitEvaluation} className="space-y-8">
              <div className="bg-white bg-opacity-10 p-6 rounded-lg shadow-md">
                <ContributionSelect
                  contributions={contributions}
                  selectedContributionId={selectedContribution?.id?.toString() || ""}
                  onChange={handleContributionChange}
                  isSubmitting={isSubmitting}
                  evaluatedContributions={evaluatedContributions}
                />
              </div>

              {selectedContribution && (
                <>
                  {evaluatedContributions.includes(selectedContribution.id ?? 0n) && <AlreadyEvaluatedBanner />}
                  <div className="bg-white bg-opacity-10 p-6 rounded-lg shadow-md">
                    <ContributionDetails contribution={selectedContribution} />
                  </div>

                  <div className="bg-white bg-opacity-10 p-6 rounded-lg shadow-md">
                    <EvaluationCriteria
                      criteria={prize.criteriaNames || []}
                      scores={scores}
                      onScoreChange={handleScoreChange}
                      isSubmitting={isSubmitting}
                    />
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    type="submit"
                    className={`button-primary w-full ${
                      isFormValid() && !isSubmitting && !evaluatedContributions.includes(selectedContribution.id ?? 0n)
                        ? "hover:bg-purple-700"
                        : "bg-gray-400 cursor-not-allowed"
                    }`}
                    disabled={
                      !isFormValid() || isSubmitting || evaluatedContributions.includes(selectedContribution.id ?? 0n)
                    }
                  >
                    {isSubmitting ? "Submitting..." : "Submit Evaluation"}
                  </motion.button>
                </>
              )}
            </form>
          </ManagementCard>
        )}
      </div>
    </div>
  );
};

export default Evaluator;
